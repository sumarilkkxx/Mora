"""模板加载器 — 加载 YAML 模板，处理继承、预设引用和校验。"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import yaml


def deep_merge(base: dict, override: dict) -> dict:
    """递归合并字典。列表完全替换，标量覆盖。"""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _resolve_preset_refs(data: Any, presets_dir: Path) -> Any:
    """递归查找 $preset:xxx.yyy 引用并替换为预设值。"""
    if isinstance(data, str) and data.startswith("$preset:"):
        ref = data[len("$preset:"):]
        parts = ref.split(".", 1)
        if len(parts) != 2:
            raise ValueError(f"预设引用格式错误: {data}（应为 $preset:文件名.键名）")

        file_name, key_name = parts
        preset_path = presets_dir / f"{file_name}.yaml"
        if not preset_path.exists():
            raise FileNotFoundError(f"预设文件不存在: {preset_path}")

        with open(preset_path, "r", encoding="utf-8") as f:
            preset_data = yaml.safe_load(f) or {}

        if key_name not in preset_data:
            raise KeyError(f"预设文件 {file_name}.yaml 中不存在键 '{key_name}'")

        return copy.deepcopy(preset_data[key_name])

    if isinstance(data, dict):
        return {k: _resolve_preset_refs(v, presets_dir) for k, v in data.items()}
    if isinstance(data, list):
        return [_resolve_preset_refs(item, presets_dir) for item in data]
    return data


def validate_template(template: dict) -> list[str]:
    """校验模板合法性，返回错误列表（空列表表示通过）。"""
    errors: list[str] = []

    if "canvas" not in template:
        errors.append("缺少必填字段: canvas")
    else:
        canvas = template["canvas"]
        if "width" not in canvas or "height" not in canvas:
            errors.append("canvas 缺少 width 或 height")
        fps = canvas.get("fps", 30)
        if fps > 60:
            errors.append(f"fps 不能超过 60 (当前: {fps})")

    audio = template.get("audio", {})
    voice_vol = audio.get("voice", {}).get("volume", 1.0)
    if not (0 <= voice_vol <= 1):
        errors.append(f"voice.volume 范围应为 0-1 (当前: {voice_vol})")

    bgm_vol = audio.get("bgm", {}).get("volume", 0.15)
    if not (0 <= bgm_vol <= 1):
        errors.append(f"bgm.volume 范围应为 0-1 (当前: {bgm_vol})")

    bgm_file = audio.get("bgm", {}).get("file")
    if bgm_file and not Path(bgm_file).exists():
        pass  # BGM 文件缺失不阻止启动，运行时跳过

    copy_config = template.get("copy", {})
    script_tpl = copy_config.get("script_template", "")
    if script_tpl:
        variables = copy_config.get("variables", [])
        defined_names = {v.get("name") for v in variables}
        presets = copy_config.get("presets", {})
        defined_names.update(presets.keys())

        import re
        used_vars = set(re.findall(r"\{\{\s*(\w+)\s*\}\}", script_tpl))
        undefined = used_vars - defined_names
        if undefined:
            errors.append(f"文案模板引用了未定义的变量: {undefined}")

    return errors


def load_template(
    template_path: Path,
    templates_dir: Path | None = None,
) -> dict:
    """加载单个模板文件，处理继承和预设引用。"""
    template_path = Path(template_path)
    if not template_path.exists():
        raise FileNotFoundError(f"模板文件不存在: {template_path}")

    with open(template_path, "r", encoding="utf-8") as f:
        template = yaml.safe_load(f) or {}

    if templates_dir is None:
        templates_dir = template_path.parent

    extends = template.pop("extends", None)
    if extends:
        parent_path = templates_dir / f"{extends}.yaml"
        if parent_path.exists():
            with open(parent_path, "r", encoding="utf-8") as f:
                parent = yaml.safe_load(f) or {}
            parent.pop("extends", None)
            template = deep_merge(parent, template)

    presets_dir = templates_dir / "_presets"
    if presets_dir.is_dir():
        template = _resolve_preset_refs(template, presets_dir)

    return template


def load_all_templates(templates_dir: Path) -> list[dict]:
    """加载模板目录中所有 .yaml 模板（排除 _global 和 _presets）。"""
    templates_dir = Path(templates_dir)
    templates: list[dict] = []

    for yaml_file in sorted(templates_dir.glob("*.yaml")):
        if yaml_file.stem.startswith("_"):
            continue
        try:
            tpl = load_template(yaml_file, templates_dir)
            templates.append(tpl)
        except Exception:
            pass  # 跳过无法加载的模板

    return templates
