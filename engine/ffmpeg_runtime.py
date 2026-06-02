"""FFmpeg 运行时自provision —— 让服务自带 ffmpeg/ffprobe，用户无需手动安装。

策略（按优先级）：
1. 若系统 PATH 已有 ffmpeg + ffprobe，直接使用。
2. 否则通过 `static-ffmpeg` 获取/下载对应平台的静态二进制，并将其目录注入
   当前进程的 PATH —— 引擎内部一律按名字调用 `ffmpeg`/`ffprobe`，因此无需改动。

`ensure_ffmpeg()` 幂等，可在服务/CLI 启动时安全调用。
"""

from __future__ import annotations

import os
import shutil

_RESULT: dict | None = None


def _prepend_path(directory: str) -> None:
    parts = os.environ.get("PATH", "").split(os.pathsep)
    if directory not in parts:
        os.environ["PATH"] = directory + os.pathsep + os.environ.get("PATH", "")


def ensure_ffmpeg(force: bool = False) -> dict:
    """确保 ffmpeg/ffprobe 可用，返回 {available, source, ffmpeg, ffprobe, error}。"""
    global _RESULT
    if _RESULT is not None and not force:
        return _RESULT

    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if ffmpeg and ffprobe:
        _RESULT = {
            "available": True,
            "source": "system",
            "ffmpeg": ffmpeg,
            "ffprobe": ffprobe,
        }
        return _RESULT

    try:
        import static_ffmpeg.run as sf

        ff, fp = sf.get_or_fetch_platform_executables_else_raise()
        _prepend_path(os.path.dirname(ff))
        _RESULT = {
            "available": True,
            "source": "bundled",
            "ffmpeg": ff,
            "ffprobe": fp,
        }
    except Exception as e:  # noqa: BLE001 - 缺失时降级而非崩溃
        _RESULT = {
            "available": False,
            "source": None,
            "ffmpeg": ffmpeg,
            "ffprobe": ffprobe,
            "error": str(e),
        }
    return _RESULT
