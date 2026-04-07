"""文案生成模块 — 根据模板和变量生成视频文案。"""

from __future__ import annotations

import random
from typing import Any

from jinja2 import Template, UndefinedError


def pick_random_preset(presets: dict[str, list[str]], key: str) -> str:
    """从预设库中随机选取一条文案片段。"""
    options = presets.get(key, [])
    if not options:
        raise KeyError(f"预设 '{key}' 不存在或为空")
    return random.choice(options)


def render_title(template_config: dict, variables: dict[str, Any] | None = None) -> str:
    """从模板 copy 配置中生成标题文本。

    使用 title_template（默认 '{{ headline }}'）和预设池随机组合。
    """
    variables = dict(variables) if variables else {}
    presets = template_config.get("presets", {})

    for key in presets:
        if key not in variables:
            variables[key] = pick_random_preset(presets, key)

    var_defs = template_config.get("variables", [])
    for var_def in var_defs:
        name = var_def.get("name", "")
        if name not in variables:
            variables[name] = var_def.get("default", "")

    title_tpl = template_config.get("title_template", "{{ headline }}")
    try:
        tpl = Template(title_tpl)
        return tpl.render(**variables).strip()
    except (UndefinedError, Exception):
        return ""


def render_copy(template_config: dict, variables: dict[str, Any] | None = None) -> str:
    """使用 Jinja2 渲染文案模板，返回完整文案文本。

    Args:
        template_config: 模板中的 copy 配置段
        variables: 用户提供的变量 (product_name, feature 等)
    """
    variables = variables or {}
    script_template = template_config.get("script_template", "")
    if not script_template:
        raise ValueError("模板缺少 script_template 字段")

    presets = template_config.get("presets", {})
    for key in presets:
        if key not in variables:
            variables[key] = pick_random_preset(presets, key)

    var_defs = template_config.get("variables", [])
    for var_def in var_defs:
        name = var_def.get("name", "")
        required = var_def.get("required", False)
        default = var_def.get("default", "")

        if name not in variables:
            if required:
                raise ValueError(f"必填变量 '{name}' 未提供 (描述: {var_def.get('description', '')})")
            variables[name] = default

    try:
        tpl = Template(script_template)
        return tpl.render(**variables).strip()
    except UndefinedError as e:
        raise ValueError(f"文案渲染失败，变量缺失: {e}")
