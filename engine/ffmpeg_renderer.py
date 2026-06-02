"""FFmpeg 直出渲染器 — 将模板 + 素材 + TTS 编译为 FFmpeg 命令并执行。"""

from __future__ import annotations

import asyncio
import math
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
        title_text: str = "",
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

        editing_config = template.get("editing", {})
        target_duration = self._calc_target_duration(tts, timeline_config)

        technique = self._pick_editing_technique(
            editing_config, asset, target_duration
        )

        is_cinematic = (
            technique == "cinematic"
            and asset.type == "video"
            and asset.duration
            and asset.duration > 0
        )

        # --- 主素材输入 ---
        if is_cinematic:
            video_input_label, audio_from_video_idx, input_idx = (
                self._build_cinematic_input(
                    asset, inputs, filter_parts, input_idx,
                    effects_config, target_duration, target_fps,
                )
            )
        elif asset.type == "video":
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

        if is_cinematic:
            vf_chain.append(self._build_cinematic_scale_filter(
                target_w, target_h, effects_config
            ))
            beat_expr = self._build_beat_brightness_expr(target_duration)
            vf_chain.append(
                f"eq=brightness='{beat_expr}+0.015*sin(t*0.7)'"
                f":saturation='1+0.05*sin(t*0.4)'"
                f":contrast='1+0.02*sin(t*0.3)'"
            )
        else:
            fit_mode = timeline_config.get("body", {}).get("fit_mode", "cover_center")
            vf_chain.append(self._build_scale_filter(
                asset, target_w, target_h, target_fps, fit_mode
            ))

            if asset.type == "image":
                frames = int(target_duration * target_fps)
                vf_chain.append(
                    f"zoompan=z='min(zoom+0.001,1.3)':d={frames}"
                    f":s={target_w}x{target_h}:fps={target_fps}"
                )

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
            fade_start = max(0, target_duration - fade_d)
            vf_chain.append(f"fade=t=out:st={fade_start:.2f}:d={fade_d}")

        # 合并视频滤镜
        if vf_chain:
            vf_str = ",".join(vf_chain)
            filter_parts.append(f"{current_v}{vf_str}[v_main]")
            current_v = "[v_main]"

        # --- 标题覆盖层 ---
        title_config = template.get("title", {})
        if title_text and title_config.get("enabled"):
            title_filter = self._build_title_filter(
                title_text, title_config,
                target_w, target_h, target_duration, output_path
            )
            if title_filter:
                filter_parts.append(f"{current_v}{title_filter}[v_title]")
                current_v = "[v_title]"

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
        cmd.extend(["-pix_fmt", "yuv420p"])
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
        """计算目标视频总时长：TTS 时长 + 尾部缓冲。

        intro 与 TTS 开头重叠（淡入），不额外占用时长；
        outro 在 TTS 结束后保留短暂淡出缓冲。
        """
        base = tts.duration if tts and tts.duration > 0 else 10.0
        outro_d = timeline.get("outro", {}).get("duration", 0)
        tail_buffer = min(outro_d, 1.5)
        return base + tail_buffer

    def _pick_editing_technique(
        self, editing_config: dict, asset: MediaAsset, target_duration: float
    ) -> str:
        """选择剪辑手法，优先使用 cinematic。"""
        techniques = editing_config.get("techniques", [])
        available_names = [t.get("name") for t in techniques if t.get("name")]

        if not available_names or asset.type != "video" or not asset.duration:
            return "trim_fade"

        if "cinematic" in available_names:
            return "cinematic"

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

    def _build_cinematic_input(
        self,
        asset: MediaAsset,
        inputs: list[str],
        filter_parts: list[str],
        input_idx: int,
        effects_config: dict,
        target_duration: float,
        target_fps: int,
    ) -> tuple[str, int | None, int]:
        """cinematic 手法：自适应慢放 + 回弹播放，绝不重复也不冻结。

        策略：
        1. 计算刚好填满目标时长的速度（最低 0.6x）；
        2. 若 0.6x 仍不够，将源视频末段反向播放（bounce），
           通过 crossfade 无缝衔接正向与反向片段，消除冻结帧。
        """
        min_speed = 0.6
        auto_speed = asset.duration / target_duration
        slowdown = max(min_speed, auto_speed)
        pts_factor = 1.0 / slowdown
        effective_dur = asset.duration * pts_factor

        inputs.extend(["-i", str(asset.path)])
        audio_idx = input_idx if asset.has_audio else None
        vid = f"[{input_idx}:v]"

        if effective_dur >= target_duration:
            filter_parts.append(
                f"{vid}setpts={pts_factor:.4f}*PTS,"
                f"fps={target_fps},"
                f"trim=duration={target_duration:.2f},"
                f"setpts=PTS-STARTPTS[v_cin]"
            )
        else:
            xfade_dur = 0.5
            remaining = target_duration - effective_dur
            rev_dur_needed = remaining + xfade_dur
            rev_source_dur = min(rev_dur_needed * slowdown,
                                 asset.duration * 0.85)
            rev_dur_actual = rev_source_dur * pts_factor
            trim_start = max(0, asset.duration - rev_source_dur)
            xfade_offset = max(0.1, effective_dur - xfade_dur)

            filter_parts.append(f"{vid}split=2[_fwd_in][_rev_in]")
            filter_parts.append(
                f"[_fwd_in]setpts={pts_factor:.4f}*PTS,"
                f"fps={target_fps}[_fwd]"
            )
            filter_parts.append(
                f"[_rev_in]trim=start={trim_start:.4f},"
                f"setpts=PTS-STARTPTS,reverse,"
                f"setpts={pts_factor:.4f}*PTS,"
                f"fps={target_fps}[_rev]"
            )
            filter_parts.append(
                f"[_fwd][_rev]xfade=transition=fade:"
                f"duration={xfade_dur:.2f}:"
                f"offset={xfade_offset:.2f}[v_cin]"
            )

        return "[v_cin]", audio_idx, input_idx + 1

    def _build_cinematic_scale_filter(
        self, tw: int, th: int, effects_config: dict
    ) -> str:
        """缩放 + 复合 Ken Burns 运镜（多频叠加，轨迹更自然）。"""
        kb = effects_config.get("ken_burns", {})
        zoom_range = kb.get("zoom_range", 0.08)
        drift_speed = kb.get("drift_speed", 0.15)

        overshoot = 1 + zoom_range
        sw = int(tw * overshoot)
        sh = int(th * overshoot)
        sw += sw % 2
        sh += sh % 2

        mx = (sw - tw) // 2
        my = (sh - th) // 2
        dx = max(1, mx // 2)
        dy = max(1, my // 2)
        dx2 = max(1, dx // 3)
        dy2 = max(1, dy // 3)
        sp1 = drift_speed
        sp2 = round(drift_speed * 2.6, 4)
        sp3 = round(drift_speed * 0.7, 4)
        sp4 = round(drift_speed * 2.1, 4)

        return (
            f"scale={sw}:{sh}:force_original_aspect_ratio=increase,"
            f"crop={tw}:{th}"
            f":x='{mx}+{dx}*sin(t*{sp1})+{dx2}*sin(t*{sp2})'"
            f":y='{my}+{dy}*cos(t*{sp3})+{dy2}*cos(t*{sp4})'"
        )

    def _build_beat_brightness_expr(
        self, target_duration: float, n_beats: int = 3
    ) -> str:
        """生成节奏性明暗脉冲的 eq brightness 表达式。

        交替使用压暗脉冲和增亮闪光，模拟剪辑转场的呼吸节奏。
        奇数 beat 压暗（模拟「呼」），偶数 beat 增亮（模拟「吸」/闪白过渡）。
        """
        pulse_dur = 0.45
        dark_depth = -0.40
        bright_depth = 0.15
        parts: list[str] = []
        interval = target_duration / (n_beats + 1)
        for i in range(1, n_beats + 1):
            t = interval * i
            depth = dark_depth if i % 2 == 1 else bright_depth
            parts.append(
                f"if(between(t,{t:.2f},{t + pulse_dur:.2f}),"
                f"{depth}*sin((t-{t:.2f})*{math.pi / pulse_dur:.4f}),0)"
            )
        return "+".join(parts) if parts else "0"

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

    def _hex_to_ass_color(self, hex_color: str, alpha: int = 0) -> str:
        """#RRGGBB → &HAABBGGRR (ASS 格式)。"""
        c = hex_color.lstrip("#")
        r, g, b = c[0:2], c[2:4], c[4:6]
        return f"&H{alpha:02X}{b}{g}{r}"

    @staticmethod
    def _wrap_text(text: str, max_chars: int, max_lines: int = 0) -> str:
        """将中文长文本按最大字符数自动折行（\\N 分隔）。"""
        if len(text) <= max_chars:
            return text
        lines: list[str] = []
        while text:
            if len(text) <= max_chars:
                lines.append(text)
                break
            cut = max_chars
            for punct in "，。、！？；：）」》】":
                idx = text.rfind(punct, 0, max_chars)
                if idx > max_chars // 3:
                    cut = idx + 1
                    break
            lines.append(text[:cut])
            text = text[cut:]
        if max_lines > 0 and len(lines) > max_lines:
            lines = lines[:max_lines]
        return "\\N".join(lines)

    def _srt_to_styled_ass(
        self, srt_path: Path, style: dict, canvas_w: int, canvas_h: int
    ) -> Path:
        """将 SRT 转换为双层 ASS 字幕：模糊底条层 + 清晰文字层。

        Layer 0 (SubBG):  BorderStyle=3 半透明底条 + \\blur 柔化边缘
        Layer 1 (SubText): BorderStyle=1 清晰文字 + 细描边
        两层叠加产生「磨砂玻璃背景 + 锐利文字」的精致效果。
        """
        import re

        font = style.get("font", "Microsoft YaHei")
        font_size = style.get("font_size", 48)
        color = style.get("color", "#FFFFFF")
        bold = 1 if style.get("bold", False) else 0
        spacing = style.get("spacing", 1.5)
        margin_v = style.get("margin_v", 480)
        margin_h = style.get("margin_h", 120)
        fade_in = style.get("fade_in", 220)
        fade_out = style.get("fade_out", 120)
        alignment = style.get("alignment", 2)
        shadow_depth = style.get("shadow", 2.0)

        outline_cfg = style.get("outline")
        if isinstance(outline_cfg, dict):
            outline_color = outline_cfg.get("color", "#000000")
            outline_w = outline_cfg.get("width", 2.0)
        else:
            outline_color = style.get("outline_color", "#000000")
            outline_w = style.get("outline_width", 2.0)

        bg_cfg = style.get("background")
        has_bg = isinstance(bg_cfg, dict) and bg_cfg.get("enabled")
        if has_bg:
            bg_color = bg_cfg.get("color", "#000000")
            bg_opacity = bg_cfg.get("opacity", 0.45)
            bg_alpha = round((1.0 - bg_opacity) * 255)
            bg_padding = bg_cfg.get("padding_v", 10)
            bg_blur = bg_cfg.get("blur", 5)
        else:
            bg_color = "#000000"
            bg_alpha = 120
            bg_padding = 10
            bg_blur = 0

        ref_short = 1080
        actual_short = min(canvas_w, canvas_h)
        scale = actual_short / ref_short
        font_size = max(12, round(font_size * scale))
        outline_w = round(outline_w * scale, 1)
        shadow_depth = round(shadow_depth * scale, 1)
        margin_v = max(15, round(margin_v * scale))
        margin_h = max(10, round(margin_h * scale))
        bg_pad_scaled = max(8, round(bg_padding * scale))

        max_chars_cfg = style.get("max_chars_per_line")
        max_lines_cfg = style.get("max_lines", 0)
        if max_chars_cfg:
            max_chars = int(max_chars_cfg)
        else:
            usable_w = canvas_w - margin_h * 2
            max_chars = max(6, int(usable_w / (font_size * 0.95)))

        primary = self._hex_to_ass_color(color, 0)
        secondary = self._hex_to_ass_color("#00FFFF", 0)
        transparent = self._hex_to_ass_color("#000000", 255)

        # SubBG: 半透明底条，用 \blur 柔化边缘营造磨砂质感
        bg_box_c = self._hex_to_ass_color(bg_color, bg_alpha)
        style_bg = (
            f"Style: SubBG,{font},{font_size},{primary},{secondary},"
            f"{bg_box_c},{transparent},{bold},0,0,0,100,100,{spacing},0,"
            f"3,{bg_pad_scaled},0,"
            f"{alignment},{margin_h},{margin_h},{margin_v},1"
        )

        # SubText: 清晰文字 + 细描边 + 轻投影
        text_outline_c = self._hex_to_ass_color(outline_color, 0)
        text_shadow_c = self._hex_to_ass_color("#000000", 100)
        style_text = (
            f"Style: SubText,{font},{font_size},{primary},{secondary},"
            f"{text_outline_c},{text_shadow_c},{bold},0,0,0,100,100,{spacing},0,"
            f"1,{outline_w},{shadow_depth},"
            f"{alignment},{margin_h},{margin_h},{margin_v},1"
        )

        header = (
            "[Script Info]\n"
            "ScriptType: v4.00+\n"
            f"PlayResX: {canvas_w}\n"
            f"PlayResY: {canvas_h}\n"
            "WrapStyle: 0\n"
            "ScaledBorderAndShadow: yes\n\n"
            "[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
            "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
            "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding\n"
            f"{style_bg}\n"
            f"{style_text}\n\n"
            "[Events]\n"
            "Format: Layer, Start, End, Style, Name, "
            "MarginL, MarginR, MarginV, Effect, Text\n"
        )

        srt_text = srt_path.read_text(encoding="utf-8")
        pattern = re.compile(
            r"(\d+)\s*\n"
            r"(\d{2}:\d{2}:\d{2})[,.](\d{3})\s*-->\s*"
            r"(\d{2}:\d{2}:\d{2})[,.](\d{3})\s*\n"
            r"(.*?)(?=\n\n|\n\d+\s*\n|\Z)",
            re.DOTALL,
        )

        dialogues: list[str] = []
        for m in pattern.finditer(srt_text):
            start = f"{m.group(2)}.{m.group(3)[:2]}"
            end = f"{m.group(4)}.{m.group(5)[:2]}"
            raw = m.group(6).strip().replace("\n", "")
            text = self._wrap_text(raw, max_chars, max_lines_cfg)
            fade_tag = f"\\fad({fade_in},{fade_out})"

            if has_bg and bg_blur > 0:
                dialogues.append(
                    f"Dialogue: 0,{start},{end},SubBG,,0,0,0,,"
                    f"{{{fade_tag}\\blur{bg_blur}}}{text}"
                )
            dialogues.append(
                f"Dialogue: 1,{start},{end},SubText,,0,0,0,,"
                f"{{{fade_tag}}}{text}"
            )

        ass_content = header + "\n".join(dialogues) + "\n"
        ass_path = srt_path.with_suffix(".ass")
        ass_path.write_text(ass_content, encoding="utf-8-sig")
        return ass_path

    def _build_subtitle_filter(
        self, srt_path: Path, style: dict, canvas_w: int, canvas_h: int
    ) -> str:
        ass_path = self._srt_to_styled_ass(srt_path, style, canvas_w, canvas_h)
        ass_escaped = str(ass_path).replace("\\", "/").replace(":", "\\:")
        return f"ass='{ass_escaped}'"

    def _build_title_ass(
        self,
        title_text: str,
        title_config: dict,
        canvas_w: int,
        canvas_h: int,
        duration: float,
        output_dir: Path,
    ) -> Path:
        """创建标题覆盖层的 ASS 文件（全时段显示）。

        支持 title_text 中包含 '\\n' 分隔的 hashtag 行，
        hashtag 行会以更小字号和暖色调渲染。
        """
        style = title_config.get("style", {})
        font = style.get("font", "Microsoft YaHei")
        font_size = style.get("font_size", 68)
        color = style.get("color", "#FFFFFF")
        bold = 1 if style.get("bold", True) else 0
        alignment = style.get("alignment", 8)
        margin_v = style.get("margin_v", 200)
        margin_h = style.get("margin_h", 120)
        outline_color = style.get("outline_color", "#000000")
        outline_w = style.get("outline_width", 3.0)
        shadow_depth = style.get("shadow", 2.0)
        spacing = style.get("spacing", 2.0)
        fade_in = style.get("fade_in", 500)
        fade_out = style.get("fade_out", 500)
        max_chars = style.get("max_chars_per_line", 14)
        max_lines = style.get("max_lines", 2)
        hashtag_color = style.get("hashtag_color", "#F5DEB3")

        ref_short = 1080
        actual_short = min(canvas_w, canvas_h)
        scale = actual_short / ref_short
        font_size = max(12, round(font_size * scale))
        hashtag_size = max(10, round(font_size * 0.52))
        outline_w = round(outline_w * scale, 1)
        shadow_depth = round(shadow_depth * scale, 1)
        margin_v = max(15, round(margin_v * scale))
        margin_h = max(10, round(margin_h * scale))

        primary = self._hex_to_ass_color(color, 0)
        secondary = self._hex_to_ass_color("#00FFFF", 0)
        outline_c = self._hex_to_ass_color(outline_color, 0)
        back_c = self._hex_to_ass_color("#000000", 200)
        hashtag_ass_c = self._hex_to_ass_color(hashtag_color, 0)

        lines = title_text.split("\n")
        title_line = lines[0].strip()
        hashtag_line = lines[1].strip() if len(lines) > 1 else ""

        wrapped = self._wrap_text(title_line, max_chars, max_lines)
        if hashtag_line:
            wrapped += f"\\N{{\\fs{hashtag_size}\\1c{hashtag_ass_c}\\b0}}{hashtag_line}"

        h = int(duration) // 3600
        m = (int(duration) % 3600) // 60
        s = int(duration) % 60
        cs = int((duration - int(duration)) * 100)
        end_time = f"{h}:{m:02d}:{s:02d}.{cs:02d}"

        header = (
            "[Script Info]\n"
            "ScriptType: v4.00+\n"
            f"PlayResX: {canvas_w}\n"
            f"PlayResY: {canvas_h}\n"
            "WrapStyle: 0\n"
            "ScaledBorderAndShadow: yes\n\n"
            "[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
            "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
            "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding\n"
            f"Style: Title,{font},{font_size},{primary},{secondary},"
            f"{outline_c},{back_c},{bold},0,0,0,100,100,{spacing},0,"
            f"1,{outline_w},{shadow_depth},"
            f"{alignment},{margin_h},{margin_h},{margin_v},1\n\n"
            "[Events]\n"
            "Format: Layer, Start, End, Style, Name, "
            "MarginL, MarginR, MarginV, Effect, Text\n"
        )

        anim = f"{{\\fad({fade_in},{fade_out})}}"
        dialogue = f"Dialogue: 0,0:00:00.00,{end_time},Title,,0,0,0,,{anim}{wrapped}\n"

        ass_content = header + dialogue
        output_dir.mkdir(parents=True, exist_ok=True)
        ass_path = output_dir / "title.ass"
        ass_path.write_text(ass_content, encoding="utf-8-sig")
        return ass_path

    def _build_title_filter(
        self,
        title_text: str,
        title_config: dict,
        canvas_w: int,
        canvas_h: int,
        duration: float,
        output_path: Path,
    ) -> str | None:
        """构建标题覆盖层滤镜，返回 ass= 滤镜字符串。"""
        if not title_text or not title_config.get("enabled"):
            return None
        temp_dir = output_path.parent / "_temp"
        ass_path = self._build_title_ass(
            title_text, title_config, canvas_w, canvas_h, duration, temp_dir
        )
        ass_escaped = str(ass_path).replace("\\", "/").replace(":", "\\:")
        return f"ass='{ass_escaped}'"

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
