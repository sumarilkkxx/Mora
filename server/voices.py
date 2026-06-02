"""TTS 语音目录 — 精选 edge-tts 中文语音，供前端选择。

保持静态列表以确保离线可用与快速响应；如需完整列表可调用 edge-tts。
"""

from __future__ import annotations

VOICES: list[dict] = [
    {
        "id": "zh-CN-XiaoxiaoNeural",
        "name": "晓晓",
        "gender": "female",
        "style": "活泼亲切",
        "scene": "产品推荐、日常种草",
        "recommended": True,
    },
    {
        "id": "zh-CN-XiaoyiNeural",
        "name": "晓伊",
        "gender": "female",
        "style": "温柔治愈",
        "scene": "情感故事、口播",
        "recommended": True,
    },
    {
        "id": "zh-CN-YunxiNeural",
        "name": "云希",
        "gender": "male",
        "style": "阳光自然",
        "scene": "教程、解说",
        "recommended": True,
    },
    {
        "id": "zh-CN-YunjianNeural",
        "name": "云健",
        "gender": "male",
        "style": "沉稳磁性",
        "scene": "纪录片、旁白",
        "recommended": False,
    },
    {
        "id": "zh-CN-YunyangNeural",
        "name": "云扬",
        "gender": "male",
        "style": "专业播报",
        "scene": "新闻、正式场合",
        "recommended": False,
    },
    {
        "id": "zh-CN-XiaomengNeural",
        "name": "晓梦",
        "gender": "female",
        "style": "甜美元气",
        "scene": "美妆、生活分享",
        "recommended": False,
    },
    {
        "id": "zh-CN-liaoning-XiaobeiNeural",
        "name": "晓北（东北）",
        "gender": "female",
        "style": "幽默接地气",
        "scene": "搞笑、方言段子",
        "recommended": False,
    },
    {
        "id": "zh-CN-shaanxi-XiaoniNeural",
        "name": "晓妮（陕西）",
        "gender": "female",
        "style": "方言特色",
        "scene": "地域特色内容",
        "recommended": False,
    },
    {
        "id": "zh-HK-HiuMaanNeural",
        "name": "曉曼（粤语）",
        "gender": "female",
        "style": "粤语",
        "scene": "粤语内容",
        "recommended": False,
    },
    {
        "id": "zh-TW-HsiaoChenNeural",
        "name": "曉臻（台湾）",
        "gender": "female",
        "style": "台湾腔",
        "scene": "台湾受众",
        "recommended": False,
    },
]


def list_voices() -> list[dict]:
    return VOICES
