"""ClipCraft FastAPI 应用 — REST API + WebSocket 实时进度 + 前端静态托管。

启动：
    uvicorn server.app:app --reload          # 开发（前端用 Vite dev server）
    python -m server                          # 生产（托管 web/dist 构建产物）
"""

from __future__ import annotations

import asyncio
import shutil
import uuid
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine.ffmpeg_runtime import ensure_ffmpeg
from engine.scanner import VIDEO_EXTS, get_media_info, scan_folder
from engine.template_loader import load_all_templates, load_template

from .jobs import JobManager, JobParams
from .voices import list_voices

# 启动即自provision ffmpeg/ffprobe（系统已装则直接复用），用户无需手动安装。
FFMPEG = ensure_ffmpeg()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_DIST = PROJECT_ROOT / "web" / "dist"
UPLOAD_DIR = PROJECT_ROOT / "uploads"

MEDIA_EXTS = {
    ".mp4", ".mov", ".avi", ".mkv", ".webm",
    ".jpg", ".jpeg", ".png", ".webp", ".bmp",
    ".mp3", ".wav", ".aac", ".m4a",
}


def load_config() -> dict:
    path = PROJECT_ROOT / "config.yaml"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


CONFIG = load_config()
manager = JobManager(CONFIG)

app = FastAPI(title="ClipCraft API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

api = FastAPI(title="ClipCraft API (v1)")


# ============ 请求模型 ============

class ScanRequest(BaseModel):
    input_path: str


class CreateJobRequest(BaseModel):
    input_path: str
    output_dir: str | None = None
    template_name: str | None = None
    voice: str = "zh-CN-XiaoxiaoNeural"
    rate: str = "+0%"
    workers: int = Field(default=4, ge=1, le=16)
    variables: dict[str, Any] = Field(default_factory=dict)


# ============ 路由 ============

@api.get("/health")
def health() -> dict:
    return {"status": "ok"}


@api.get("/config")
def get_config() -> dict:
    tts = CONFIG.get("tts", {})
    batch = CONFIG.get("batch", {})
    return {
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
        "ffprobe_available": shutil.which("ffprobe") is not None,
        "ffmpeg_source": FFMPEG.get("source"),
        "defaults": {
            "voice": tts.get("default_voice", "zh-CN-XiaoxiaoNeural"),
            "rate": tts.get("default_rate", "+0%"),
            "workers": batch.get("max_workers", 4),
        },
        "project_root": str(PROJECT_ROOT),
    }


@api.get("/voices")
def get_voices() -> list[dict]:
    return list_voices()


@api.get("/templates")
def get_templates() -> list[dict]:
    templates_dir = _templates_dir()
    out: list[dict] = []
    for tpl in load_all_templates(templates_dir):
        meta = tpl.get("meta", {})
        canvas = tpl.get("canvas", {})
        rules = tpl.get("match_rules", {})
        out.append({
            "name": meta.get("name", "unknown"),
            "description": meta.get("description", ""),
            "tags": meta.get("tags", []),
            "version": meta.get("version", ""),
            "is_default": meta.get("is_default", False),
            "canvas": {
                "width": canvas.get("width"),
                "height": canvas.get("height"),
                "fps": canvas.get("fps"),
            },
            "aspect_ratio": rules.get("aspect_ratio"),
        })
    return out


@api.get("/templates/{name}")
def get_template_detail(name: str) -> dict:
    templates_dir = _templates_dir()
    tpl_path = templates_dir / f"{name}.yaml"
    if not tpl_path.exists():
        raise HTTPException(status_code=404, detail=f"模板不存在: {name}")
    tpl = load_template(tpl_path, templates_dir)
    meta = tpl.get("meta", {})
    copy_cfg = tpl.get("copy", {})
    return {
        "name": meta.get("name", name),
        "description": meta.get("description", ""),
        "tags": meta.get("tags", []),
        "canvas": tpl.get("canvas", {}),
        "match_rules": tpl.get("match_rules", {}),
        "variables": copy_cfg.get("variables", []),
        "effects": tpl.get("effects", {}),
        "audio": {
            "voice_id": tpl.get("audio", {}).get("voice", {}).get("voice_id"),
            "rate": tpl.get("audio", {}).get("voice", {}).get("rate"),
        },
    }


@api.post("/scan")
async def scan(req: ScanRequest) -> dict:
    input_path = Path(req.input_path).expanduser()
    if not input_path.exists():
        raise HTTPException(status_code=400, detail=f"路径不存在: {input_path}")
    try:
        assets = await asyncio.to_thread(scan_folder, input_path)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e

    videos = [a for a in assets if a.type == "video"]
    images = [a for a in assets if a.type == "image"]
    audios = [a for a in assets if a.type == "audio"]
    total_duration = sum(a.duration or 0 for a in assets)
    total_size = sum(a.file_size for a in assets)

    return {
        "input_path": str(input_path),
        "summary": {
            "total": len(assets),
            "videos": len(videos),
            "images": len(images),
            "audios": len(audios),
            "total_duration": round(total_duration, 1),
            "total_size_mb": round(total_size / 1024 / 1024, 1),
        },
        "assets": [a.to_dict() for a in assets],
    }


@api.post("/upload")
async def upload(file: UploadFile = File(...)) -> dict:
    """上传单个视频素材，保存到 uploads/ 并返回其元数据。"""
    name = Path(file.filename or "video").name
    ext = Path(name).suffix.lower()
    if ext not in VIDEO_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"仅支持视频文件（{', '.join(sorted(VIDEO_EXTS))}）",
        )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    saved = UPLOAD_DIR / f"{uuid.uuid4().hex[:8]}_{name}"

    try:
        with open(saved, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                out.write(chunk)
    finally:
        await file.close()

    try:
        asset = await asyncio.to_thread(get_media_info, saved)
    except Exception as e:  # noqa: BLE001
        saved.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"无法解析视频：{e}") from e

    return {"path": str(saved), "name": name, "asset": asset.to_dict()}


@api.post("/jobs")
async def create_job(req: CreateJobRequest) -> dict:
    if req.output_dir:
        output_dir = str(Path(req.output_dir).expanduser())
    else:
        from datetime import datetime
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = str(PROJECT_ROOT / "output" / stamp)

    params = JobParams(
        input_path=str(Path(req.input_path).expanduser()),
        output_dir=output_dir,
        template_name=req.template_name,
        voice=req.voice,
        rate=req.rate,
        workers=req.workers,
        variables=req.variables,
    )
    job = manager.create_job(params)
    return job.to_dict()


@api.get("/jobs")
def list_jobs() -> list[dict]:
    return manager.list_jobs()


@api.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job.to_dict()


@api.get("/jobs/{job_id}/files/{filename}")
def get_job_file(job_id: str, filename: str):
    job = manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    base = Path(job.params.output_dir).resolve()
    target = (base / filename).resolve()
    if base not in target.parents and target != base:
        raise HTTPException(status_code=403, detail="非法路径")
    if not target.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(target)


@api.get("/file")
def get_file(path: str):
    """供输入素材预览：仅允许已存在的媒体文件。"""
    p = Path(path).expanduser().resolve()
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    if p.suffix.lower() not in MEDIA_EXTS:
        raise HTTPException(status_code=403, detail="不支持的文件类型")
    return FileResponse(p)


@api.websocket("/jobs/{job_id}/ws")
async def job_ws(websocket: WebSocket, job_id: str) -> None:
    await websocket.accept()
    job = manager.get(job_id)
    if not job:
        await websocket.send_json({"type": "error", "message": "任务不存在"})
        await websocket.close()
        return

    queue = job.subscribe()
    try:
        # 先发送当前完整快照，便于后加入的客户端立即同步状态
        await websocket.send_json({"type": "snapshot", "job": job.to_dict()})
        if job.status in ("completed", "failed"):
            await websocket.send_json({"type": "__end__"})
            return
        while True:
            event = await queue.get()
            if event.get("type") == "__end__":
                await websocket.send_json(event)
                break
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        job.unsubscribe(queue)


def _templates_dir() -> Path:
    d = Path(CONFIG.get("paths", {}).get("templates_dir", "./templates"))
    if not d.is_absolute():
        d = PROJECT_ROOT / d
    return d


# ============ 挂载 ============

app.mount("/api", api)


if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = (WEB_DIST / full_path).resolve()
        if (
            full_path
            and WEB_DIST in candidate.parents
            and candidate.is_file()
        ):
            return FileResponse(candidate)
        index = WEB_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
        return JSONResponse({"detail": "前端尚未构建，请运行 npm run build"}, status_code=404)
