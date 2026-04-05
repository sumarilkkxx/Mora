"""FFmpeg 直出渲染器 — 将模板 + 素材 + TTS 编译为 FFmpeg 命令并执行。"""

from __future__ import annotations

import asyncio
import random
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .scanner import MediaAsset
from .tts import TTSResult


@dataclass
class RenderResult:
    success: bool
    output_path: Path | None
    exit_code: int
    stderr: str
    command: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "output_path": str(self.output_path) if self.output_path else None,
            "exit_code": self.exit_code,
            "stderr": self.stderr[-500:] if len(self.stderr) > 500 else self.stderr,
        }


class FFmpegRenderer:
    """将模板参数编译为 FFmpeg 命令并执行渲染。"""

    def __init__(self, ffmpeg_config: dict | None = None):
        cfg = ffmpeg_config or {}
        self.video_codec = cfg.get("video_codec", "libx264")
        self.audio_codec = cfg.get("audio_codec", "aac")
        self.preset = cfg.get("preset", "fast")
        self.crf = cfg.get("crf", 23)
        self.audio_bitrate = cfg.get("audio_bitrate", "192k")
        self.movflags = cfg.get("movflags", "+faststart")
        self.hw_accel = cfg.get("hardware_accel")

    def build_command(
        self,
        asset: MediaAsset,
        tts: TTSResult | None,
        bgm_path: Path | None,
        template: dict,
        output_path: Path,
    ) -> list[str]:
        """将模板参数编译为 FFmpeg 命令行参数列表。"""
        canvas = template.get("canvas", {})
        target_w = canvas.get("width", 1080)
        target_h = canvas.get("height", 1920)
        target_fps = canvas.get("fps", 30)

        audio_config = template.get("audio", {})
        subtitle_config = template.get("subtitles", {})
        watermark_config = template.get("watermark", {})
        effects_config = template.get("effects", {})
        timeline_config = template.get("timeline", {})

        inputs: list[str] = []
        filter_parts: list[str] = []
        input_idx = 0
        # raw input indices — brackets added only for filter_complex expressions
        _raw_inputs: dict[str, int] = {}

        editing_config = template.get("editing", {})
        target_duration = self._calc_target_duration(tts, timeline_config)

        # --- 选择剪辑手法 ---
        technique = self._pick_editing_technique(
            editing_config, asset, target_duration
        )

        # --- 主素材输入 ---
        if asset.type == "video":
            if technique == "loop":
                inputs.extend(["-stream_loop", "-1", "-i", str(asset.path)])
            else:
                inputs.extend(["-i", str(asset.path)])
            video_input_label = f"[{input_idx}:v]"
            audio_from_video_idx = input_idx if asset.has_audio else None
            input_idx += 1
        elif asset.type == "image":
            inputs.extend([
                "-loop", "1",
                "-i", str(asset.path),
                "-t", str(target_duration),
            ])
            video_input_label = f"[{input_idx}:v]"
            audio_from_video_idx = None
            input_idx += 1

        # --- TTS 音频输入 ---
        tts_input_idx = None
        if tts and tts.audio_path.exists():
            inputs.extend(["-i", str(tts.audio_path)])
            tts_input_idx = input_idx
            input_idx += 1

        # --- BGM 输入 ---
        bgm_input_idx = None
        if bgm_path and bgm_path.exists():
            inputs.extend(["-i", str(bgm_path)])
            bgm_input_idx = input_idx
            input_idx += 1

        # --- 水印输入 ---
        watermark_input_label = None
        wm_image = watermark_config.get("image")
        if wm_image:
            wm_path = Path(wm_image)
            if wm_path.exists():
                inputs.extend(["-i", str(wm_path)])
                watermark_input_label = f"[{input_idx}:v]"
                input_idx += 1

        # --- 视频滤镜链 ---
        current_v = video_input_label
        vf_chain: list[str] = []

        # 缩放 + 裁剪
        fit_mode = timeline_config.get("body", {}).get("fit_mode", "cover_center")
        vf_chain.append(self._build_scale_filter(
            asset, target_w, target_h, target_fps, fit_mode
        ))

        # Ken Burns 效果（图片素材）
        if asset.type == "image":
            frames = int(target_duration * target_fps)
            vf_chain.append(
                f"zoompan=z='min(zoom+0.001,1.3)':d={frames}:s={target_w}x{target_h}:fps={target_fps}"
            )

        # --- 视频时长适配（仅视频素材） ---
        if asset.type == "video" and asset.duration and tts:
            adapt_filter = self._build_duration_adapt_filter(
                asset.duration, target_duration, target_fps, technique
            )
            if adapt_filter:
                vf_chain.append(adapt_filter)

        # 色彩效果
        color_grade = effects_config.get("color_grade", "none")
        if color_grade and color_grade != "none":
            vf_chain.append(self._build_color_grade(color_grade))

        # 暗角
        vignette = effects_config.get("vignette", 0)
        if vignette and float(vignette) > 0:
            angle = float(vignette) * 0.5
            vf_chain.append(f"vignette=angle={angle}")

        # 淡入淡出
        intro_config = timeline_config.get("intro", {})
        if intro_config.get("type") == "title_card":
            fade_d = min(intro_config.get("duration", 1.0), 1.0)
            vf_chain.append(f"fade=t=in:st=0:d={fade_d}")
        outro_config = timeline_config.get("outro", {})
        if outro_config:
            outro_d = outro_config.get("duration", 1.0)
            fade_d = min(outro_d, 1.0)

        # 合并视频滤镜
        if vf_chain:
            vf_str = ",".join(vf_chain)
            filter_parts.append(f"{current_v}{vf_str}[v_main]")
            current_v = "[v_main]"

        # --- 字幕 ---
        srt_source = subtitle_config.get("source", "")
        if srt_source == "tts_srt" and tts and tts.srt_path.exists():
            style = subtitle_config.get("style", {})
            sub_filter = self._build_subtitle_filter(
                tts.srt_path, style, target_w, target_h
            )
            filter_parts.append(f"{current_v}{sub_filter}[v_sub]")
            current_v = "[v_sub]"

        # --- 水印叠加 ---
        if watermark_input_label:
            wm_size = watermark_config.get("size", 80)
            wm_opacity = watermark_config.get("opacity", 0.6)
            wm_pos = watermark_config.get("position", "bottom_right")
            ox, oy = self._watermark_position(wm_pos, target_w, target_h)

            filter_parts.append(
                f"{watermark_input_label}scale=-1:{wm_size},"
                f"colorchannelmixer=aa={wm_opacity}[wm_scaled]"
            )
            filter_parts.append(
                f"{current_v}[wm_scaled]overlay={ox}:{oy}[v_wm]"
            )
            current_v = "[v_wm]"

        # --- 音频混合 ---
        audio_map = self._build_audio_mix(
            tts_input_idx, bgm_input_idx, audio_from_video_idx,
            audio_config, filter_parts
        )

        # --- 构建完整命令 ---
        cmd = ["ffmpeg", "-y"]
        cmd.extend(inputs)

        if filter_parts:
            cmd.extend(["-filter_complex", ";".join(filter_parts)])

        cmd.extend(["-map", current_v])
        if audio_map:
            cmd.extend(["-map", audio_map])

        encoder = self.hw_accel if self.hw_accel else self.video_codec
        cmd.extend(["-c:v", encoder])
        cmd.extend(["-preset", self.preset])
        cmd.extend(["-crf", str(self.crf)])
        cmd.extend(["-c:a", self.audio_codec])
        cmd.extend(["-b:a", self.audio_bitrate])
        cmd.extend(["-movflags", self.movflags])
        cmd.extend(["-t", str(round(target_duration, 2))])

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cmd.append(str(output_path))

        return cmd

    async def render(self, command: list[str]) -> RenderResult:
        """异步执行 FFmpeg 子进程。"""
        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr_bytes = await proc.communicate()
            stderr = stderr_bytes.decode("utf-8", errors="replace")
            exit_code = proc.returncode or 0
            output_path = Path(command[-1]) if exit_code == 0 else None

            return RenderResult(
                success=exit_code == 0,
                output_path=output_path,
                exit_code=exit_code,
                stderr=stderr,
                command=command,
            )
        except Exception as e:
            return RenderResult(
                success=False,
                output_path=None,
                exit_code=-1,
                stderr=str(e),
                command=command,
            )

    def render_sync(self, command: list[str]) -> RenderResult:
        """同步执行 FFmpeg 子进程（用于单条测试）。"""
        try:
            result = subprocess.run(
                command, capture_output=True, text=True, timeout=300
            )
            output_path = Path(command[-1]) if result.returncode == 0 else None
            return RenderResult(
                success=result.returncode == 0,
                output_path=output_path,
                exit_code=result.returncode,
                stderr=result.stderr,
                command=command,
            )
        except Exception as e:
            return RenderResult(
                success=False, output_path=None, exit_code=-1,
                stderr=str(e), command=command,
            )

    # ---- 内部辅助方法 ----

    def _calc_target_duration(self, tts: TTSResult | None, timeline: dict) -> float:
        """计算目标视频总时长：TTS 时长 + intro + outro。"""
        base = tts.duration if tts and tts.duration > 0 else 10.0
        intro_d = timeline.get("intro", {}).get("duration", 0)
        outro_d = timeline.get("outro", {}).get("duration", 0)
        return base + intro_d + outro_d

    def _pick_editing_technique(
        self, editing_config: dict, asset: MediaAsset, target_duration: float
    ) -> str:
        """从模板的 editing.techniques 中随机选取一种适用的剪辑手法。"""
        techniques = editing_config.get("techniques", [])
        available_names = [t.get("name") for t in techniques if t.get("name")]

        if not available_names or asset.type != "video" or not asset.duration:
            return "trim_fade"

        video_dur = asset.duration
        ratio = video_dur / target_duration if target_duration > 0 else 1.0

        suitable: list[str] = []
        for name in available_names:
            if name == "loop" and ratio < 1.0:
                suitable.append(name)
            elif name == "freeze_end" and 0.5 <= ratio < 1.0:
                suitable.append(name)
            elif name == "speed_adjust" and 0.6 <= ratio <= 1.6:
                suitable.append(name)
            elif name == "trim_fade" and ratio > 0.9:
                suitable.append(name)

        if not suitable:
            if ratio < 1.0:
                return "loop"
            return "trim_fade"

        return random.choice(suitable)

    def _build_duration_adapt_filter(
        self,
        video_duration: float,
        target_duration: float,
        fps: int,
        technique: str,
    ) -> str | None:
        """根据剪辑手法生成时长适配的 FFmpeg 滤镜。"""
        if target_duration <= 0 or video_duration <= 0:
            return None

        ratio = video_duration / target_duration

        if technique == "speed_adjust":
            speed = max(0.5, min(2.0, ratio))
            pts_factor = 1.0 / speed
            return f"setpts={pts_factor:.4f}*PTS"

        elif technique == "freeze_end":
            if ratio >= 1.0:
                return f"trim=duration={target_duration},setpts=PTS-STARTPTS"
            pad_seconds = target_duration - video_duration
            return f"tpad=stop_mode=clone:stop_duration={pad_seconds:.2f}"

        elif technique == "loop":
            return f"trim=duration={target_duration},setpts=PTS-STARTPTS"

        elif technique == "trim_fade":
            if ratio > 1.0:
                fade_start = max(0, target_duration - 1.0)
                return (
                    f"trim=duration={target_duration},setpts=PTS-STARTPTS,"
                    f"fade=t=out:st={fade_start:.2f}:d=1.0"
                )
            return None

        return None

    def _build_scale_filter(
        self, asset: MediaAsset, tw: int, th: int, fps: int, fit_mode: str
    ) -> str:
        if asset.type == "image":
            return f"scale={tw}:{th}:force_original_aspect_ratio=decrease,pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:black"

        if fit_mode == "cover_center":
            return (
                f"fps={fps},"
                f"scale={tw}:{th}:force_original_aspect_ratio=increase,"
                f"crop={tw}:{th}"
            )
        elif fit_mode == "fit_contain":
            return (
                f"fps={fps},"
                f"scale={tw}:{th}:force_original_aspect_ratio=decrease,"
                f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:black"
            )
        else:  # stretch
            return f"fps={fps},scale={tw}:{th}"

    def _build_color_grade(self, grade: str) -> str:
        grades = {
            "warm_boost": "colortemperature=temperature=6800,eq=saturation=1.2:brightness=0.02",
            "cool_tone": "colortemperature=temperature=5200,eq=saturation=1.1",
            "vintage": "curves=vintage,eq=saturation=0.8:brightness=-0.03",
            "high_contrast": "eq=contrast=1.3:brightness=0.01:saturation=1.15",
        }
        return grades.get(grade, "")

    def _adapt_subtitle_size(
        self, font_size: int, outline_width: int, canvas_w: int, canvas_h: int
    ) -> tuple[int, int, int]:
        """根据画布分辨率自适应字幕大小、描边和底部边距。

        以 1080x1920 为基准分辨率，按短边比例缩放。
        """
        reference_short = 1080
        actual_short = min(canvas_w, canvas_h)
        scale = actual_short / reference_short

        adapted_size = max(16, round(font_size * scale))
        adapted_outline = max(1, round(outline_width * scale))
        adapted_margin = max(20, round(60 * scale))
        return adapted_size, adapted_outline, adapted_margin

    def _build_subtitle_filter(
        self, srt_path: Path, style: dict, canvas_w: int, canvas_h: int
    ) -> str:
        font = style.get("font", "Microsoft YaHei")
        font_size = style.get("font_size", 42)
        color = style.get("color", "#FFFFFF").lstrip("#")
        outline_color = style.get("outline_color", "#000000").lstrip("#")
        outline_width = style.get("outline_width", 2)

        font_size, outline_width, margin_v = self._adapt_subtitle_size(
            font_size, outline_width, canvas_w, canvas_h
        )

        # FFmpeg ASS 颜色格式: &HBBGGRR (BGR 顺序)
        primary = f"&H{color[4:6]}{color[2:4]}{color[0:2]}"
        outline = f"&H{outline_color[4:6]}{outline_color[2:4]}{outline_color[0:2]}"

        srt_escaped = str(srt_path).replace("\\", "/").replace(":", "\\:")
        force_style = (
            f"FontName={font},"
            f"FontSize={font_size},"
            f"PrimaryColour={primary},"
            f"OutlineColour={outline},"
            f"OutlineWidth={outline_width},"
            f"MarginV={margin_v}"
        )
        return f"subtitles='{srt_escaped}':force_style='{force_style}'"

    def _watermark_position(
        self, position: str, tw: int, th: int
    ) -> tuple[str, str]:
        margin = 20
        positions = {
            "top_left": (str(margin), str(margin)),
            "top_right": (f"W-w-{margin}", str(margin)),
            "bottom_left": (str(margin), f"H-h-{margin}"),
            "bottom_right": (f"W-w-{margin}", f"H-h-{margin}"),
            "center": ("(W-w)/2", "(H-h)/2"),
        }
        return positions.get(position, positions["bottom_right"])

    def _build_audio_mix(
        self,
        tts_idx: int | None,
        bgm_idx: int | None,
        video_audio_idx: int | None,
        audio_config: dict,
        filter_parts: list[str],
    ) -> str | None:
        """构建音频混合滤镜，返回 -map 可用的标签。

        Returns filter label "[a_out]" when filters are used,
        or raw stream "N:a" when no filter needed.
        """
        bgm_cfg = audio_config.get("bgm", {})
        bgm_volume = bgm_cfg.get("volume", 0.15)

        tts_label = f"[{tts_idx}:a]" if tts_idx is not None else None
        bgm_label = f"[{bgm_idx}:a]" if bgm_idx is not None else None

        if tts_idx is not None and bgm_idx is not None:
            ducking = bgm_cfg.get("ducking", {})
            if ducking.get("enabled"):
                # asplit 复制 TTS 流：一路给 sidechain 检测，一路混入输出
                filter_parts.append(
                    f"{tts_label}asplit=2[tts_sc][tts_mix]"
                )
                filter_parts.append(
                    f"{bgm_label}volume={bgm_volume}[bgm_vol]"
                )
                # sidechaincompress: 用 tts_sc 触发对 BGM 的压缩（配音响时 BGM 压低）
                target_vol = ducking.get("target_volume", 0.1)
                ratio = max(2, min(4, round(1 / target_vol))) if target_vol > 0 else 3
                filter_parts.append(
                    f"[bgm_vol][tts_sc]sidechaincompress="
                    f"threshold=0.03:ratio={ratio}:attack=200:release=800"
                    f"[bgm_ducked]"
                )
                filter_parts.append(
                    f"[tts_mix][bgm_ducked]amix=inputs=2:duration=first:weights=1 0.8[a_out]"
                )
            else:
                filter_parts.append(
                    f"{bgm_label}volume={bgm_volume}[bgm_vol]"
                )
                filter_parts.append(
                    f"{tts_label}[bgm_vol]amix=inputs=2:duration=first:weights=1 0.8[a_out]"
                )
            return "[a_out]"

        if tts_idx is not None:
            return f"{tts_idx}:a"

        if bgm_idx is not None:
            filter_parts.append(f"{bgm_label}volume={bgm_volume}[a_out]")
            return "[a_out]"

        if video_audio_idx is not None:
            return f"{video_audio_idx}:a"

        return None
