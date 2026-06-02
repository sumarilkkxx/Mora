"""素材扫描模块 — 扫描输入文件夹，提取所有媒体素材的元数据。"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Literal

from PIL import Image

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
AUDIO_EXTS = {".mp3", ".wav", ".aac", ".m4a"}
ALL_MEDIA_EXTS = VIDEO_EXTS | IMAGE_EXTS | AUDIO_EXTS


@dataclass
class MediaAsset:
    path: Path
    type: Literal["video", "image", "audio"]
    duration: float | None
    width: int
    height: int
    fps: float | None
    codec: str | None
    has_audio: bool
    file_size: int
    aspect_ratio: Literal["portrait", "landscape", "square"]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["path"] = str(self.path)
        return d


def _classify_aspect_ratio(w: int, h: int) -> Literal["portrait", "landscape", "square"]:
    if w == 0 or h == 0:
        return "landscape"
    ratio = w / h
    if ratio > 1.05:
        return "landscape"
    elif ratio < 0.95:
        return "portrait"
    return "square"


def _run_ffprobe(file_path: Path) -> dict:
    """调用 ffprobe 获取媒体文件的 JSON 元数据。"""
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(file_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {file_path}: {result.stderr}")
    return json.loads(result.stdout)


def get_media_info(file_path: Path) -> MediaAsset:
    """提取单个媒体文件的元数据。"""
    file_path = Path(file_path).resolve()
    suffix = file_path.suffix.lower()
    file_size = file_path.stat().st_size

    if suffix in IMAGE_EXTS:
        return _get_image_info(file_path, file_size)

    probe = _run_ffprobe(file_path)
    streams = probe.get("streams", [])
    fmt = probe.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    if suffix in AUDIO_EXTS or (video_stream is None and audio_stream is not None):
        return _build_audio_asset(file_path, audio_stream, fmt, file_size)

    if video_stream is None:
        raise ValueError(f"No video/audio stream found in {file_path}")

    width = int(video_stream.get("width", 0))
    height = int(video_stream.get("height", 0))
    duration = float(fmt.get("duration", 0))

    fps_str = video_stream.get("r_frame_rate", "0/1")
    try:
        num, den = fps_str.split("/")
        fps = float(num) / float(den) if float(den) != 0 else None
    except (ValueError, ZeroDivisionError):
        fps = None

    return MediaAsset(
        path=file_path,
        type="video",
        duration=duration if duration > 0 else None,
        width=width,
        height=height,
        fps=round(fps, 2) if fps else None,
        codec=video_stream.get("codec_name"),
        has_audio=audio_stream is not None,
        file_size=file_size,
        aspect_ratio=_classify_aspect_ratio(width, height),
    )


def _get_image_info(file_path: Path, file_size: int) -> MediaAsset:
    with Image.open(file_path) as img:
        width, height = img.size
    return MediaAsset(
        path=file_path,
        type="image",
        duration=None,
        width=width,
        height=height,
        fps=None,
        codec=None,
        has_audio=False,
        file_size=file_size,
        aspect_ratio=_classify_aspect_ratio(width, height),
    )


def _build_audio_asset(
    file_path: Path, audio_stream: dict, fmt: dict, file_size: int
) -> MediaAsset:
    duration = float(fmt.get("duration", 0))
    return MediaAsset(
        path=file_path,
        type="audio",
        duration=duration if duration > 0 else None,
        width=0,
        height=0,
        fps=None,
        codec=audio_stream.get("codec_name") if audio_stream else None,
        has_audio=True,
        file_size=file_size,
        aspect_ratio="landscape",
    )


def scan_folder(input_dir: Path) -> list[MediaAsset]:
    """扫描文件夹，返回所有媒体素材的元数据列表。"""
    input_dir = Path(input_dir).resolve()
    if not input_dir.is_dir():
        if input_dir.is_file() and input_dir.suffix.lower() in ALL_MEDIA_EXTS:
            return [get_media_info(input_dir)]
        raise FileNotFoundError(f"Input path not found: {input_dir}")

    assets: list[MediaAsset] = []
    for f in sorted(input_dir.rglob("*")):
        if f.suffix.lower() not in ALL_MEDIA_EXTS:
            continue
        try:
            assets.append(get_media_info(f))
        except Exception:
            pass  # 跳过无法解析的文件
    return assets
