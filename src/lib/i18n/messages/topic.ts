import type { NamespaceMessages } from "../config";

// topic 命名空间词条（zh 为原文，en 为翻译）
export const topic: NamespaceMessages = {
  zh: {
    // 页面标题区
    heroBadge: "从创作主题开始",
    heroTitle: "把一个主题写成视频",
    heroSubtitle:
      "输入一个主题，生成旁白脚本，再匹配可用素材并合成为竖屏视频。适合知识、故事、生活方式等非商品内容。",
    // 未配置 LLM 引导
    llmBannerTitle: "连接脚本模型后即可开始",
    llmBannerDesc: "请在设置中填写脚本模型的服务地址、API Key 和模型名称。",
    llmBannerCta: "配置脚本模型",
    // 主题输入
    topicLabel: "创作主题",
    topicPlaceholder: "例如：在家如何泡一杯手冲咖啡",
    tryLabel: "示例主题",
    exampleTopic1: "在家如何泡一杯手冲咖啡",
    exampleTopic2: "城市夜景为什么这么治愈",
    exampleTopic3: "三个让早晨更高效的小习惯",
    exampleTopic4: "雨天适合做的五件小事",
    exampleTopic5: "为什么我们总是怀念童年",
    // 旁白风格
    narrationLabel: "旁白风格",
    narration_knowledge_label: "知识科普",
    narration_knowledge_desc: "讲清一个主题，长知识",
    narration_story_label: "情感故事",
    narration_story_desc: "有代入感的叙事，引共鸣",
    narration_lifestyle_label: "生活方式",
    narration_lifestyle_desc: "精致 vlog 旁白，有质感",
    narration_inspiration_label: "励志金句",
    narration_inspiration_desc: "节奏明快，适合点赞收藏",
    narration_travel_label: "旅行风光",
    narration_travel_desc: "目的地 + 风景，想出发",
    // 时长
    durationLabel: "目标时长",
    // 生成按钮
    generatingScript: "正在生成脚本…",
    ctaGenerate: "生成脚本",
    // 流程提示
    flowStep1: "1 写脚本",
    flowStep2: "2 自动配画面",
    flowStep3: "3 合成成片",
    // 错误提示
    errorNoLlm: "尚未配置脚本模型。请先在设置中填写 API Key。",
    errorGenerateCheckLlm: "脚本未能生成。请检查模型配置后重试。",
    errorGenerate: "脚本未能生成，请重试。",
  },
  en: {
    // 页面标题区
    heroBadge: "Start from a creative brief",
    heroTitle: "Turn one topic into a video",
    heroSubtitle:
      "Enter a topic, generate a voiceover script, match available footage, and compose a vertical video. Suitable for explainers, stories, and lifestyle content.",
    // 未配置 LLM 引导
    llmBannerTitle: "Connect a script model to begin",
    llmBannerDesc: "Add the service URL, API key, and model name for script generation in Settings.",
    llmBannerCta: "Configure script model",
    // 主题输入
    topicLabel: "Creative brief",
    topicPlaceholder: "e.g. How to brew a pour-over coffee at home",
    tryLabel: "Example topics",
    exampleTopic1: "How to brew a pour-over coffee at home",
    exampleTopic2: "Why city nightscapes feel so soothing",
    exampleTopic3: "Three small habits for a more productive morning",
    exampleTopic4: "Five little things to do on a rainy day",
    exampleTopic5: "Why we always miss our childhood",
    // 旁白风格
    narrationLabel: "Narration style",
    narration_knowledge_label: "Explainer",
    narration_knowledge_desc: "Break down a topic and teach something new",
    narration_story_label: "Emotional story",
    narration_story_desc: "Immersive narrative that strikes a chord",
    narration_lifestyle_label: "Lifestyle",
    narration_lifestyle_desc: "Polished vlog voiceover with a refined feel",
    narration_inspiration_label: "Inspiring quotes",
    narration_inspiration_desc: "Snappy pacing, great for likes and saves",
    narration_travel_label: "Travel & scenery",
    narration_travel_desc: "Destinations and views that make you want to go",
    // 时长
    durationLabel: "Target length",
    // 生成按钮
    generatingScript: "Generating script…",
    ctaGenerate: "Generate script",
    // 流程提示
    flowStep1: "1 Write script",
    flowStep2: "2 Auto-fill footage",
    flowStep3: "3 Render video",
    // 错误提示
    errorNoLlm: "No script model is configured. Add an API key in Settings first.",
    errorGenerateCheckLlm: "The script could not be generated. Check the model setup and try again.",
    errorGenerate: "The script could not be generated. Try again.",
  },
};
