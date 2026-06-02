"""模板匹配引擎 — 根据素材特征自动选择最合适的模板。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .scanner import MediaAsset


def calculate_match_score(asset: MediaAsset, template: dict) -> float:
    """计算素材与模板的匹配分数。"""
    score = 0.0
    rules = template.get("match_rules", {})

    for kw in rules.get("filename_contains", []):
        if kw.lower() in asset.path.stem.lower():
            score += 30
            break

    folder_name = asset.path.parent.name.lower()
    for fn in rules.get("folder_name", []):
        if fn.lower() == folder_name:
            score += 20
            break

    expected_ratio = rules.get("aspect_ratio")
    if expected_ratio and expected_ratio == asset.aspect_ratio:
        score += 20

    if asset.duration is not None:
        min_d = rules.get("min_duration", 0)
        max_d = rules.get("max_duration", float("inf"))
        if min_d <= asset.duration <= max_d:
            score += 10

    priority = rules.get("priority", 0)
    score *= (1 + priority / 100)

    return score


def match_template(
    asset: MediaAsset,
    templates: list[dict],
    threshold: float = 30.0,
) -> tuple[dict, float]:
    """返回最佳匹配的模板及匹配分数。低于阈值则返回 default 模板。"""
    best_template = None
    best_score = -1.0

    default_template = None
    fallback_template = None
    for t in templates:
        if t.get("meta", {}).get("is_default"):
            default_template = t
        if t.get("meta", {}).get("name") == "default":
            fallback_template = t
    if default_template is None:
        default_template = fallback_template

    for t in templates:
        score = calculate_match_score(asset, t)
        if score > best_score:
            best_score = score
            best_template = t

    if best_score < threshold:
        if default_template:
            return default_template, 0.0
        if templates:
            return templates[0], 0.0
        raise ValueError("没有可用的模板")

    return best_template, best_score


def match_batch(
    assets: list[MediaAsset],
    templates: list[dict],
    threshold: float = 30.0,
) -> dict[str, tuple[dict, float]]:
    """批量匹配，返回 {素材路径字符串: (模板, 分数)} 的映射。"""
    result: dict[str, tuple[dict, float]] = {}
    for asset in assets:
        tpl, score = match_template(asset, templates, threshold)
        result[str(asset.path)] = (tpl, score)
    return result
