"""Job 管理器 — 异步运行批量剪辑引擎，并通过事件队列向订阅者推送实时进度。

设计要点：
- 每个 Job 在事件循环中以独立 asyncio.Task 运行完整管线（扫描 → 匹配 → 渲染）。
- BatchProcessor 的同步 progress_callback 在协程内被调用，可安全地 put_nowait 到队列。
- 维护任务快照，使后加入的 WebSocket 订阅者能立即获得当前完整状态。
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from engine.batch import BatchProcessor, EditTask, create_tasks
from engine.scanner import scan_folder
from engine.template_loader import (
    load_all_templates,
    load_template,
    validate_template,
)
from engine.template_matcher import match_batch

JobStatus = Literal["pending", "scanning", "running", "completed", "failed"]

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class JobParams:
    input_path: str
    output_dir: str
    template_name: str | None = None
    voice: str = "zh-CN-XiaoxiaoNeural"
    rate: str = "+0%"
    workers: int = 4
    variables: dict[str, Any] = field(default_factory=dict)


@dataclass
class Job:
    id: str
    params: JobParams
    status: JobStatus = "pending"
    created_at: str = field(default_factory=_now_iso)
    finished_at: str | None = None
    started_ts: float = field(default_factory=time.time)
    elapsed: float = 0.0
    total: int = 0
    error: str | None = None
    tasks: dict[str, dict] = field(default_factory=dict)
    report: dict | None = None
    _subscribers: set[asyncio.Queue] = field(default_factory=set, repr=False)
    _runner: asyncio.Task | None = field(default=None, repr=False)

    # ---- 序列化 ----

    def counts(self) -> dict:
        success = sum(1 for t in self.tasks.values() if t["status"] == "success")
        failed = sum(1 for t in self.tasks.values() if t["status"] == "failed")
        skipped = sum(1 for t in self.tasks.values() if t["status"] == "skipped")
        processing = sum(
            1 for t in self.tasks.values() if t["status"] == "processing"
        )
        done = success + failed + skipped
        return {
            "success": success,
            "failed": failed,
            "skipped": skipped,
            "processing": processing,
            "done": done,
            "pending": max(0, self.total - done - processing),
        }

    def to_dict(self) -> dict:
        elapsed = self.elapsed or (time.time() - self.started_ts)
        return {
            "id": self.id,
            "status": self.status,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
            "elapsed_seconds": round(elapsed, 1),
            "total": self.total,
            "error": self.error,
            "counts": self.counts(),
            "params": {
                "input_path": self.params.input_path,
                "output_dir": self.params.output_dir,
                "template_name": self.params.template_name,
                "voice": self.params.voice,
                "rate": self.params.rate,
                "workers": self.params.workers,
                "variables": self.params.variables,
            },
            "tasks": list(self.tasks.values()),
            "report": self.report,
        }

    # ---- 事件 ----

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def emit(self, event: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:  # pragma: no cover - 无界队列不会满
                pass


def _task_snapshot(task: EditTask) -> dict:
    output = None
    if task.status == "success":
        output = task.output_path.name
    return {
        "id": task.id,
        "asset": task.asset.path.name,
        "asset_path": str(task.asset.path),
        "asset_type": task.asset.type,
        "template": task.template.get("meta", {}).get("name", "unknown"),
        "status": task.status,
        "error": task.error,
        "output": output,
        "title": task.title_text,
    }


class JobManager:
    """全局 Job 注册表与调度器（单进程内存态）。"""

    def __init__(self, config: dict | None = None):
        self.config = config or {}
        self.jobs: dict[str, Job] = {}

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def list_jobs(self) -> list[dict]:
        return [j.to_dict() for j in sorted(
            self.jobs.values(), key=lambda j: j.created_at, reverse=True
        )]

    def create_job(self, params: JobParams) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], params=params)
        self.jobs[job.id] = job
        job._runner = asyncio.create_task(self._run(job))
        return job

    # ---- 管线执行 ----

    async def _run(self, job: Job) -> None:
        try:
            await self._run_pipeline(job)
        except Exception as e:  # noqa: BLE001 - 单 Job 失败不影响进程
            job.status = "failed"
            job.error = str(e)
            job.finished_at = _now_iso()
            job.elapsed = time.time() - job.started_ts
            job.emit({"type": "job_failed", "error": str(e), "job": job.to_dict()})
        finally:
            job.emit({"type": "__end__"})

    async def _run_pipeline(self, job: Job) -> None:
        params = job.params
        templates_dir = Path(
            self.config.get("paths", {}).get("templates_dir", PROJECT_ROOT / "templates")
        )
        if not templates_dir.is_absolute():
            templates_dir = PROJECT_ROOT / templates_dir
        ffmpeg_config = self.config.get("ffmpeg", {})
        batch_config = self.config.get("batch", {})
        tts_config = self.config.get("tts", {})

        output_dir = Path(params.output_dir)

        # 1. 扫描素材（阻塞调用 ffprobe，放入线程）
        job.status = "scanning"
        job.emit({"type": "status", "status": "scanning", "job": job.to_dict()})
        assets = await asyncio.to_thread(scan_folder, Path(params.input_path))
        if not assets:
            raise ValueError("未在该路径下找到任何媒体素材")

        # 2. 模板匹配
        if params.template_name:
            tpl_path = templates_dir / f"{params.template_name}.yaml"
            if not tpl_path.exists():
                raise FileNotFoundError(f"模板不存在: {params.template_name}")
            tpl = load_template(tpl_path, templates_dir)
            errors = validate_template(tpl)
            if errors:
                raise ValueError("模板校验失败: " + "; ".join(errors))
            template_map = {str(a.path): (tpl, 100.0) for a in assets}
        else:
            all_templates = load_all_templates(templates_dir)
            threshold = batch_config.get("match_threshold", 30)
            template_map = match_batch(assets, all_templates, threshold)

        # 3. 创建任务
        tasks = create_tasks(assets, template_map, output_dir, params.variables)
        if not tasks:
            raise ValueError("没有可处理的任务（素材未匹配到任何模板）")

        for t in tasks:
            job.tasks[t.id] = _task_snapshot(t)
        job.total = len(tasks)
        job.status = "running"
        job.emit({"type": "job_started", "job": job.to_dict()})

        # 4. 并发渲染
        processor = BatchProcessor(
            max_workers=params.workers,
            tts_concurrent=tts_config.get("max_concurrent", 2),
            ffmpeg_config=ffmpeg_config,
        )

        def on_progress(task: EditTask) -> None:
            snap = _task_snapshot(task)
            job.tasks[task.id] = snap
            job.emit({
                "type": "task_update",
                "task": snap,
                "counts": job.counts(),
            })

        report = await processor.process_all(
            tasks=tasks,
            output_dir=output_dir,
            voice=params.voice,
            rate=params.rate,
            progress_callback=on_progress,
        )

        job.report = report.to_dict()
        job.elapsed = report.elapsed_seconds
        job.status = "completed"
        job.finished_at = _now_iso()
        job.emit({"type": "job_completed", "job": job.to_dict()})
