"""配音引擎 — 将文案文本转换为语音音频 + SRT 字幕文件。"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path

import edge_tts


@dataclass
class TTSResult:
    audio_path: Path
    srt_path: Path
    duration: float
    text: str

    def to_dict(self) -> dict:
        return {
            "audio_path": str(self.audio_path),
            "srt_path": str(self.srt_path),
            "duration": self.duration,
            "text": self.text,
        }


def _parse_srt_duration(srt_path: Path) -> float:
    """从 SRT 文件中解析最后一个时间戳，返回总时长（秒）。"""
    if not srt_path.exists():
        return 0.0
    content = srt_path.read_text(encoding="utf-8")
    timestamps = re.findall(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})", content)
    if not timestamps:
        return 0.0
    last = timestamps[-1]
    return int(last[0]) * 3600 + int(last[1]) * 60 + int(last[2]) + int(last[3]) / 1000


def _get_audio_duration(audio_path: Path) -> float:
    """使用 ffprobe 获取音频文件时长。"""
    import json
    import subprocess
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        str(audio_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode == 0:
        data = json.loads(result.stdout)
        return float(data.get("format", {}).get("duration", 0))
    return 0.0


async def generate_tts(
    text: str,
    voice: str = "zh-CN-XiaoxiaoNeural",
    rate: str = "+0%",
    output_dir: Path = Path("./temp"),
    filename_prefix: str = "tts",
) -> TTSResult:
    """生成 TTS 音频 + SRT 字幕，含重试逻辑。"""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    audio_path = output_dir / f"{filename_prefix}.mp3"
    srt_path = output_dir / f"{filename_prefix}.srt"

    max_retries = 3
    base_delay = 2.0

    for attempt in range(max_retries):
        try:
            communicate = edge_tts.Communicate(text, voice, rate=rate)
            submaker = edge_tts.SubMaker()

            with open(audio_path, "wb") as f:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        f.write(chunk["data"])
                    elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                        submaker.feed(chunk)

            srt_content = submaker.get_srt()
            srt_path.write_text(srt_content, encoding="utf-8")

            duration = _get_audio_duration(audio_path)
            if duration == 0:
                duration = _parse_srt_duration(srt_path)

            return TTSResult(
                audio_path=audio_path,
                srt_path=srt_path,
                duration=duration,
                text=text,
            )
        except Exception:
            if attempt < max_retries - 1:
                await asyncio.sleep(base_delay * (2 ** attempt))
            else:
                raise


async def batch_generate_tts(
    texts: list[str],
    voice: str = "zh-CN-XiaoxiaoNeural",
    rate: str = "+0%",
    output_dir: Path = Path("./temp"),
    max_concurrent: int = 2,
) -> list[TTSResult]:
    """批量生成 TTS，限制并发防限速。"""
    semaphore = asyncio.Semaphore(max_concurrent)
    results: list[TTSResult | None] = [None] * len(texts)

    async def _generate(idx: int, text: str) -> None:
        async with semaphore:
            results[idx] = await generate_tts(
                text=text,
                voice=voice,
                rate=rate,
                output_dir=output_dir,
                filename_prefix=f"tts_{idx:04d}",
            )

    tasks = [_generate(i, t) for i, t in enumerate(texts)]
    await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if r is not None]
