"""批量并发调度 — 管理多条视频的并发处理，提供进度追踪和错误隔离。"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from .scanner import MediaAsset
from .tts import TTSResult, generate_tts
from .copy_writer import render_copy, render_title
from .ffmpeg_renderer import FFmpegRenderer, RenderResult


@dataclass
class EditTask:
    id: str
    asset: MediaAsset
    template: dict
    tts_result: TTSResult | None = None
    copy_text: str = ""
    title_text: str = ""
    output_path: Path = Path(".")
    status: Literal["pending", "processing", "success", "failed", "skipped"] = "pending"
    error: str | None = None
    render_result: RenderResult | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "asset": str(self.asset.path),
            "template": self.template.get("meta", {}).get("name", "unknown"),
            "status": self.status,
            "error": self.error,
            "output_path": str(self.output_path),
        }


@dataclass
class BatchReport:
    total: int = 0
    success: int = 0
    failed: int = 0
    skipped: int = 0
    elapsed_seconds: float = 0.0
    tasks: list[EditTask] = field(default_factory=list)
    output_dir: Path = Path(".")

    def to_dict(self) -> dict:
        return {
            "total": self.total,
            "success": self.success,
            "failed": self.failed,
            "skipped": self.skipped,
            "elapsed_seconds": round(self.elapsed_seconds, 2),
            "output_dir": str(self.output_dir),
            "tasks": [t.to_dict() for t in self.tasks],
        }


def create_tasks(
    assets: list[MediaAsset],
    template_map: dict[str, tuple[dict, float]],
    output_dir: Path,
    copy_variables: dict[str, Any] | None = None,
) -> list[EditTask]:
    """根据素材列表和模板映射创建任务列表。"""
    tasks: list[EditTask] = []
    output_dir = Path(output_dir)
    copy_variables = copy_variables or {}

    for asset in assets:
        key = str(asset.path)
        tpl, score = template_map.get(key, ({}, 0.0))
        if not tpl:
            continue

        task_id = uuid.uuid4().hex[:8]
        stem = asset.path.stem
        out_name = f"{stem}_edited.mp4"
        out_path = output_dir / out_name

        copy_config = tpl.get("copy", {})
        try:
            copy_text = render_copy(copy_config, {**copy_variables})
        except Exception:
            copy_text = ""

        try:
            title_text = render_title(copy_config, {**copy_variables})
        except Exception:
            title_text = ""

        tasks.append(EditTask(
            id=task_id,
            asset=asset,
            template=tpl,
            copy_text=copy_text,
            title_text=title_text,
            output_path=out_path,
        ))

    return tasks


class BatchProcessor:
    """批量并发调度处理器。"""

    def __init__(
        self,
        max_workers: int = 4,
        tts_concurrent: int = 2,
        ffmpeg_config: dict | None = None,
    ):
        self.max_workers = max_workers
        self.tts_concurrent = tts_concurrent
        self.renderer = FFmpegRenderer(ffmpeg_config)

    async def process_all(
        self,
        tasks: list[EditTask],
        output_dir: Path = Path("./output"),
        voice: str = "zh-CN-XiaoxiaoNeural",
        rate: str = "+0%",
        progress_callback: Callable[[EditTask], None] | None = None,
    ) -> BatchReport:
        """并发处理所有任务，返回汇总报告。"""
        start_time = time.time()
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        temp_dir = output_dir / "_temp"
        temp_dir.mkdir(parents=True, exist_ok=True)

        render_sem = asyncio.Semaphore(self.max_workers)
        tts_sem = asyncio.Semaphore(self.tts_concurrent)

        async def _process_one(task: EditTask) -> None:
            task.status = "processing"
            if progress_callback:
                progress_callback(task)

            try:
                # 1. TTS 生成
                if task.copy_text:
                    async with tts_sem:
                        task.tts_result = await generate_tts(
                            text=task.copy_text,
                            voice=voice,
                            rate=rate,
                            output_dir=temp_dir,
                            filename_prefix=f"tts_{task.id}",
                        )

                # 2. 获取 BGM 路径（支持绝对路径和相对于项目根目录的路径）
                bgm_file = task.template.get("audio", {}).get("bgm", {}).get("file")
                bgm_path = None
                if bgm_file:
                    p = Path(bgm_file)
                    if p.is_absolute() and p.exists():
                        bgm_path = p
                    else:
                        project_root = Path(__file__).resolve().parent.parent
                        p2 = project_root / bgm_file
                        if p2.exists():
                            bgm_path = p2

                # 3. 构建 FFmpeg 命令
                cmd = self.renderer.build_command(
                    asset=task.asset,
                    tts=task.tts_result,
                    bgm_path=bgm_path,
                    template=task.template,
                    output_path=task.output_path,
                    title_text=task.title_text,
                )

                # 4. 执行渲染
                async with render_sem:
                    result = await self.renderer.render(cmd)

                task.render_result = result
                if result.success:
                    task.status = "success"
                else:
                    task.status = "failed"
                    task.error = result.stderr[-300:] if result.stderr else "FFmpeg render failed"

            except Exception as e:
                task.status = "failed"
                task.error = str(e)

            if progress_callback:
                progress_callback(task)

        await asyncio.gather(
            *[_process_one(t) for t in tasks],
            return_exceptions=True,
        )

        elapsed = time.time() - start_time
        report = BatchReport(
            total=len(tasks),
            success=sum(1 for t in tasks if t.status == "success"),
            failed=sum(1 for t in tasks if t.status == "failed"),
            skipped=sum(1 for t in tasks if t.status == "skipped"),
            elapsed_seconds=elapsed,
            tasks=tasks,
            output_dir=output_dir,
        )
        return report
