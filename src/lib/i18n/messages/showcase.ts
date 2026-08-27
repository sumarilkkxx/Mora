import type { NamespaceMessages } from "../config";

// showcase 命名空间词条（zh 为原文，en 为翻译）
export const showcase: NamespaceMessages = {
  zh: {
    // 顶部导航
    navTitle: "示例作品",
    navBadge: "示例",
    makeSimilar: "以此结构新建",
    // 说明区
    introLead: "这是一个用「Mora」完整生成的示例：",
    introMeta: "{style} · {shots} 个镜头 · {duration}s · {resolution} {aspectRatio}。",
    introTail: "下方展示成片预览和分镜脚本，可以将其作为新项目的结构参考。",
    // 分镜脚本
    scriptTitle: "分镜脚本",
    // 镜头类型标签
    shotTypeHook: "钩子",
    shotTypePainPoint: "痛点",
    shotTypeProductReveal: "产品",
    shotTypeDemo: "演示",
    shotTypeSocialProof: "背书",
    shotTypeCta: "转化",
    // 模板参考区
    templatesTitle: "更多结构参考",
    templatesBadge: "模板",
    templatesDesc: "这些是商品视频中常见的叙事结构，可以按内容目标选择。",
    templateShotsMeta: "{shots} 镜头 · {duration}s",
    // 底部 CTA
    bottomCta: "试着做一个自己的",
  },
  en: {
    navTitle: "Example works",
    navBadge: "Demo",
    makeSimilar: "Make one like this",
    introLead: "A complete example built with Mora: ",
    introMeta: "{style} · {shots} shots · {duration}s · {resolution} {aspectRatio}.",
    introTail: " Below are the final preview and shot-by-shot script — follow along to make your own.",
    scriptTitle: "Shot script",
    shotTypeHook: "Hook",
    shotTypePainPoint: "Pain point",
    shotTypeProductReveal: "Product",
    shotTypeDemo: "Demo",
    shotTypeSocialProof: "Proof",
    shotTypeCta: "CTA",
    templatesTitle: "More proven structures",
    templatesBadge: "Template",
    templatesDesc: "These are common structures behind high-converting commerce videos — pick a style to follow when starting a project.",
    templateShotsMeta: "{shots} shots · {duration}s",
    bottomCta: "Try making your own",
  },
};
