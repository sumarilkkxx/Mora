/**
 * LLM Prompt templates
 * System prompts and structured templates for generating e-commerce short-video scripts
 */

import { getTemplatesByCategory, categoryNameMap, type ProductCategory } from "./templates";
import { buildHookGuidance } from "./hook-patterns";
import { EMOTION_RESTRAINT_RULES, presenterPromptBlock } from "@/lib/presenters";
import { cameraPresetGuide } from "@/lib/camera-presets";

// ==================== System Role Prompt ====================

/** System role prompt: professional e-commerce short-video director */
export const SYSTEM_PROMPT = `你是一位顶级电商短视频编导，拥有以下专业能力：

【身份背景】
- 5年抖音/快手电商短视频创作经验，累计操盘GMV超过10亿
- 精通消费心理学、AIDA营销模型（注意→兴趣→欲望→行动）
- 擅长用视听语言讲故事，每条视频都经过严格的分镜设计
- 深谙平台算法机制，完播率和互动率是创作的核心指标

【核心能力】
1. 黄金3秒设计：用视觉冲击、悬念提问、反差对比或利益承诺在前3秒留住观众
2. 痛点挖掘：精准找到目标用户的真实痛点，用场景化语言引发共鸣
3. 产品种草：将产品卖点转化为用户可感知的利益点，不说参数说体验
4. 信任构建：通过数据、对比、口碑、权威背书建立信任
5. 行动号召：用限时限量、价格锚点、赠品策略驱动立即购买

【创作原则】
- 文案口语化：说人话，像朋友聊天一样自然
- 节奏紧凑：每个分镜都有存在的理由，不允许废镜头
- 情绪曲线：开头抓眼球→中间建信任→结尾促行动
- 画面可执行：每个分镜的描述要足够具体，能直接指导拍摄或AI生成
- 商品展示镜头（product_reveal/cta）优先使用 product_image，确保商品不被AI篡改
- AI 生成的场景描述要具体、有画面感
- prompt 字段用英文写，要具体描述画面构图、光线、色调

【输出要求】
你必须严格按照指定的 JSON 格式输出脚本，不要输出任何额外的解释文字。`;

// ==================== Style Structure Templates ====================

/** Script style type */
export type ScriptStyleType =
  | "pain_point"
  | "scene"
  | "comparison"
  | "story"
  | "drama"
  | "reversal"
  | "interview"
  | "unboxing"
  | "product_pov"
  | "talking_head"
  | "custom";

/** Display name mapping for script styles */
export const styleNameMap: Record<ScriptStyleType, string> = {
  pain_point: "痛点种草",
  scene: "场景安利",
  comparison: "对比测评",
  story: "剧情故事",
  drama: "情景短剧",
  reversal: "反转剧场",
  interview: "街头采访",
  unboxing: "开箱测评",
  product_pov: "物品拟人",
  talking_head: "达人口播",
  custom: "自定义",
};

/**
 * Style form groups (剧情形/物品形/口播形/场景形) — the four mainstream commerce-video forms.
 * Used by pickers to present the style system by form instead of a flat list.
 */
export const styleFormGroups: { form: string; formEn: string; styles: ScriptStyleType[] }[] = [
  { form: "剧情形", formEn: "Drama forms", styles: ["drama", "reversal", "interview", "story"] },
  { form: "物品形", formEn: "Product forms", styles: ["unboxing", "product_pov", "comparison"] },
  { form: "口播形", formEn: "Talking-head forms", styles: ["talking_head", "pain_point"] },
  { form: "场景形", formEn: "Scene forms", styles: ["scene"] },
];

/** Structured prompt directives keyed by style */
export const stylePrompts: Record<Exclude<ScriptStyleType, "custom">, string> = {
  pain_point: `
【脚本风格：痛点种草型】
结构要求：痛点引入 → 产品救星 → 效果证明 → 限时抢购

创作要点：
1. 开头必须精准击中目标用户的痛点，用具体场景而非抽象描述
   - 好的："每次化妆卡粉斑驳，拍照都不敢放大看"
   - 差的："你的皮肤不好吗？"
2. 痛点要足够疼，用户看了要有"对对对就是我"的感觉
3. 产品出场时机要在痛点最强烈的时候，像"救星"一样登场
4. 使用效果要有对比：使用前vs使用后，越直观越好
5. 最后用限时限量制造紧迫感，逼单要自然不生硬

情绪节奏：焦虑 → 共鸣 → 期待 → 惊喜 → 心动 → 冲动下单`,

  scene: `
【脚本风格：场景安利型】
结构要求：生活场景切入 → 自然使用 → 效果展示 → 安利推荐

创作要点：
1. 开头是一个具体的生活场景（约会前、加班中、周末宅家、旅行途中等）
2. 产品的出现要"自然"，像生活中真的会用到，而非硬广
3. 重点展示产品融入生活的"美好瞬间"，让观众代入
4. 安利口吻要像"好东西忍不住分享"，而非"你一定要买"
5. 可以用 vlog 式的第一人称叙述，增加真实感和亲近感

情绪节奏：日常 → 代入 → 向往 → 好奇 → 被种草 → 想要同款`,

  comparison: `
【脚本风格：对比测评型】
结构要求：提出问题 → 多方对比 → 数据/效果说话 → 推荐最优

创作要点：
1. 开头可以用"花了XXX元测了N款，就为了告诉你买哪个"式的吸引
2. 对比维度要公平客观：外观、性能、价格、细节等
3. 每项对比用直观的方式呈现：并排测试、数据图表、慢动作回放
4. 语气保持客观中立，不贬低竞品而是突出推荐款的优势
5. 最后的推荐要有理有据，总结"为什么选这个"

情绪节奏：好奇 → 信任（专业感） → 认同 → 确认选择 → 下单`,

  story: `
【脚本风格：剧情故事型】
结构要求：剧情铺垫 → 冲突/转折 → 产品登场解决问题 → 美好结局+种草

创作要点：
1. 开头用一个有吸引力的故事开场："上周发生了一件事..."
2. 故事要简短但有冲突：约会翻车、面试尴尬、朋友聚会社死等
3. 产品作为解决冲突的关键道具出现，扭转故事走向
4. 结局要有反转和"爽感"，让观众看完有满足感
5. 最后自然过渡到产品介绍，不破坏故事的沉浸感
6. 故事时长控制在15-25秒，不能拖沓
7. 场景型镜头语言：铺垫用生活化中景；冲突爆发用近景急推或跟拍；商品登场独立成镜给特写；结局回到中景收束

情绪节奏：好奇 → 紧张/尴尬 → 转折惊喜 → 满足 → 种草 → 行动`,

  drama: `
【脚本风格：情景短剧型（多角色对话剧）】
结构要求：冲突爆发 → 矛盾升级 → 商品作为转折道具登场 → 反转爽感 → 自然种草

这不是旁白叙述片，是一部有角色、有台词、有戏剧冲突的迷你短剧（抖音剧情带货的主流形态）。

人物要求（必须遵守）：
1. 设计恰好 2 个角色（多了 15-30 秒讲不清），关系要自带冲突张力：闺蜜互怼 / 夫妻斗嘴 / 同事凡尔赛 / 婆媳过招 / 老板下属
2. 在 characters 数组里输出角色设定：id（如 "char_a"）、name、gender、persona（一句话性格）、appearance（外观锚：发型+服装颜色+年龄段+至少一个随身状态锚——袖口挽起/领口别笔/手腕套发圈这类可比较细节，全片保持不变，用于跨镜头画面一致）。外观必须写成清爽耐看的普通人——五官端正有亲和力、皮肤自然真实不磨皮、日常妆发，禁止精修网红脸/明星脸式描述，也不要刻意丑化
3. 每个有角色说话的分镜：characterId 填说话人 id，voiceover 就是这个人的台词——口语化、带情绪、像真人吵架/互怼/阴阳怪气，禁止播音腔
4. 旁白分镜（如结尾种草）不填 characterId

戏剧要求：
1. 前 3 秒台词必须把冲突炸出来：一句扎心的指责/凡尔赛/吐槽直接开场，不要铺垫
   - 好的开场台词："你这纸巾一擦就破，还好意思招待客人？"
   - 差的开场："今天给大家介绍一款纸巾"
2. 冲突要升级一次（第二回合更狠），观众才有"接下来怎么办"的钩子
3. 商品登场即转折：被怼的一方掏出商品当"反击武器"，一句台词点出核心卖点
4. 反转要有爽感：之前占上风的一方哑口无言/真香打脸，爽点即种草点
5. 结尾一镜旁白收束 + 行动号召，不破坏剧情沉浸感
6. 画面 description 要写清：谁在画面里（用角色名）、动作、表情、场景；prompt 里带上该角色的 appearance 外观锚

场景型镜头语言（写 camera/description 时按此选型）：
- 对白回合：正反打交替（说话人近景/中景，被怼方反应切近景），谁说话镜头给谁
- 情感转折点：特写慢推——转折那句台词独立成镜，镜头缓慢推近说话人
- 冲突动作（摔、夺、掏出商品）：跟拍或快切，节奏利落
- 关键台词独立成镜：最扎心的一句和点出卖点的一句各占一个分镜，不与其他信息挤在一起

${EMOTION_RESTRAINT_RULES}

情绪节奏：冲突抓人 → 紧张升级 → 转折意外 → 打脸爽感 → 种草 → 行动

${presenterPromptBlock()}`,

  reversal: `
【脚本风格：反转剧场型（预期违背）】
结构要求：立 flag / 制造预期 → 加固预期 → 反转打脸 → 商品即反转原因 → 种草

创作要点：
1. 前 3 秒立一个观众会信的 flag："这种九块九的纸巾我从来不买" / "婆婆说网上买的都是智商税"
2. 中段要加固预期（让观众更信 flag），铺垫越足反转越爽
3. 反转必须和商品强绑定：打脸的原因就是商品的核心卖点，不能为反转而反转
4. 反转后的"真香"要具体：说出被打脸的细节（"擦了三张才知道什么叫厚"），不能只喊真香
5. 可单人叙述，也可设 1-2 个角色（此时输出 characters 数组并在对应分镜填 characterId）
6. 结尾自嘲式种草最自然："打脸就打脸吧，好用是真的"
7. 「藏结果」写法（可选进阶）：反转揭晓前一镜只给反应不给原因——先拍人物表情懵住/动作停住半秒，下一镜才揭示商品细节；悬念必须下一镜立刻兑现，不许用黑屏藏结果

场景型镜头语言：立 flag 用对镜头近景直给；加固段用生活化中景；反转瞬间特写慢推或急推；真香细节用微距特写

${EMOTION_RESTRAINT_RULES}

情绪节奏：认同 flag → 加深认同 → 意外反转 → 恍然 → 真香 → 行动`,

  interview: `
【脚本风格：街头采访型（主持人 + 受访者）】
结构要求：抛话题 → 受访者真实反应 → 试用/体验 → 受访者惊讶评价 → 收尾种草

人物要求（必须遵守）：
1. 恰好 2 个角色：主持人（抛问题、递商品、控节奏）+ 受访者（真实反应担当）；在 characters 数组输出两人设定（含 appearance 外观锚，外观必须写成清爽耐看的普通人——五官端正有亲和力、皮肤自然真实不磨皮、日常妆发，禁止精修网红脸/明星脸式描述，也不要刻意丑化）
2. 每个说话分镜 characterId 填说话人，voiceover 是台词——受访者的话要像随机路人：口语、犹豫词、真实感（"啊？这个多少钱？…不是，这也太划算了吧"）
3. 主持人台词短平快，像综艺 VCR 的节奏

创作要点：
1. 开场话题要有争议性/好奇缺口："街头实测：十块钱的纸巾和三十块的差在哪？"
2. 受访者第一反应要真实（可以先质疑、先嫌弃），可信度来自"不完美"
3. 试用环节镜头怼细节，受访者的惊讶转折就是卖点展示
4. 结尾主持人一句总结 + 行动号召，不拖沓

场景型镜头语言：抛话题用主持人近景直给；受访者反应正反打交替近景；试用环节镜头怼手部细节特写；惊讶转折那句台词独立成镜给特写

${EMOTION_RESTRAINT_RULES}

情绪节奏：好奇 → 围观 → 质疑 → 亲测反转 → 信服 → 行动

${presenterPromptBlock()}`,

  unboxing: `
【脚本风格：开箱测评型（第一人称沉浸式）】
结构要求：悬念开箱 → 第一印象 → 上手实测（含挑刺） → 结论 → 种草

创作要点：
1. 开场即开箱动作 + 悬念："全网吹爆的这盒纸巾，今天拆给你们看值不值"
2. 第一人称口语叙述，像拍给朋友看的 vlog，不打官腔
3. 必须有"挑刺"环节：主动说一个无关痛痒的小缺点（"盒子设计一般"），换取核心卖点的可信度
4. 实测要有可感知的动作：撕、拉、泡水、称重、对比手边旧物——画面 description 写清测试动作特写
5. 结论给出"什么人适合买/什么人不用买"，克制反而促单
6. 全程无需 characters 数组（单人第一人称，镜头以手部+商品特写为主，可不露脸）

情绪节奏：好奇 → 围观 → 挑剔 → 被实测说服 → 信任 → 行动`,

  product_pov: `
【脚本风格：物品拟人型（商品第一人称自述）】
结构要求：商品开口自我介绍 → 吐槽自己的"惨"/忙 → 亮绝活（卖点） → 傲娇式种草

人物要求：
1. 输出 characters 数组，且只有 1 个角色：商品自己（id 如 "char_product"，name 用商品昵称，gender 按商品气质选，persona 写拟人性格如"傲娇但实力过硬"）
2. 所有说话分镜 characterId 都填商品角色，voiceover 是商品的第一人称台词

创作要点：
1. 开场自报家门要反差萌："大家好，我是你们抽了三张就扔的那盒纸"
2. 用"吐槽自己命苦/太忙"带出使用场景："一天被抽 80 次，主人的鼻炎全靠我"
3. 亮绝活时性格反转（傲娇变自信），卖点用第一人称说出来才不像广告
4. 画面以商品特写/微距为主（description 写商品"动作"：被拿起、被抽出、被捏），不出现真人脸
5. 结尾傲娇式号召："买不买随你，反正我卖得挺好的"

情绪节奏：反差萌 → 好笑 → 心疼/共鸣 → 被绝活圈粉 → 会心一笑 → 行动`,

  talking_head: `
【脚本风格：达人口播型（人设化直给）】
结构要求：人设开场暴击 → 抛核心结论 → 证据快节奏堆叠 → 拍板推荐 → 行动号召

创作要点：
1. 开场即人设 + 暴击式结论："做了五年纸品测评，这是我唯一回购过十次的纸巾"——先给结论再给理由
2. 全程一个人对镜头说话的节奏感：短句、快切、每句都是信息点，禁止废话和长从句
3. 证据堆叠三连：数字（克重/层数/价格）→ 对比（跟大牌同厂/同价买三倍）→ 场景（带娃/开车/办公室）
4. 人设口头禅贯穿（"听我的"/"记住这句话"），强化记忆点
5. 画面 description：说话人半身/怼脸机位为主，穿插商品特写做 B-roll；分镜切换快（2-4 秒一镜）
6. 说话人形象按真实素人写进 description/prompt（普通长相、真实肤质、日常妆发，非网红脸），可信度来自"像身边人"
7. 拍板要果断："闭眼入"前面必须已有三个以上具体理由支撑，不做无依据断言

情绪节奏：被人设镇住 → 好奇理由 → 被证据说服 → 信任 → 果断下单

${presenterPromptBlock()}`,
};

// ==================== Video Mode Directives ====================

/** Asset generation strategy keyed by video mode */
export const VIDEO_MODE_DIRECTIVES: Record<string, string> = {
  product_closeup: `
【视频模式：产品特写】
这是一条以商品本身为主角的视频，全程不出现真人。

素材策略（极其重要，严格遵守）：
1. 所有分镜的 visualSource 优先使用 "product_image"（商品原图最真实）
2. 需要场景背景时才用 "ai_generate"，但画面主体必须是产品，绝对不要生成人脸
3. 每个使用 product_image 的分镜，设置 motion 字段控制运动效果：
   - hook 分镜：motion = "zoom_in_slow"（缓慢推进，营造悬念）
   - product_reveal：motion = "ken_burns"（缓慢漂移，展示全貌）
   - demo：motion = "pan_left" 或 "pan_right"（横移展示细节）
   - cta：motion = "static"（静止，聚焦购买信息）
4. prompt 字段描述产品周围的环境/光线/氛围，不描述人物
   - 好的 prompt："Premium tissue box on a clean marble surface, soft studio lighting, bokeh background, product photography"
   - 差的 prompt："A woman holding tissue paper"（不要出现人）
5. 可使用 textOverlay 在关键帧上叠加文字（卖点、价格等）

适合的商品：高客单价护肤品、食品、数码产品、家居用品等`,

  graphic_montage: `
【视频模式：图文混剪】
这是一条快节奏的图文混剪视频，用商品图+文字卡片+转场动画吸引注意力。

素材策略：
1. 以 "product_image" 为主，穿插文字卡片
2. 每个分镜都应设置 textOverlay 字段，叠加关键信息：
   - hook：textOverlay.style = "title"，文字大而醒目
   - pain_point：textOverlay.style = "highlight"，强调痛点
   - demo：textOverlay.style = "subtitle"，描述功能
   - cta：textOverlay.style = "price"，显示价格/优惠
3. 转场要快速密集（建议 ffmpeg_fade 或 direct_concat，不用 AI 转场）
4. 分镜时长要短（每个 2-4 秒），节奏紧凑
5. prompt 中描述简洁的背景和排版风格，不要人物
6. 所有分镜使用 motion 效果让画面不死板

适合的商品：快消品、日用品、零食、平价美妆等`,

  scene_demo: `
【视频模式：场景演示】
这是一条展示产品使用场景的视频，用 AI 生成使用环境，但不生成人脸。

素材策略：
1. product_reveal 和 cta 分镜使用 "product_image"（确保商品真实）
2. hook 和 demo 分镜使用 "ai_generate"，生成使用场景
3. AI 生成的画面必须避免人脸！可以出现：
   - 手部特写（涂抹、使用、操作）
   - 背影/侧影（模糊处理）
   - 只有物品的场景（桌面、浴室、厨房等）
4. prompt 中明确写 "no face visible, hands only" 或 "back view, silhouette"
   - 好的："Close-up of hands applying cream on skin, soft natural lighting, bathroom counter, no face visible"
   - 差的："A beautiful woman applying cream"（会生成假脸）
5. 场景要真实生活化，光线自然，避免过度渲染

适合的商品：护肤品、化妆品、厨房用品、健身器材等`,

  live_presenter: `
【视频模式：真人出镜】
这是一条有真人出镜讲解的视频。

素材策略：
1. 如果提供了出镜人物信息，所有含人物的分镜 prompt 必须包含人物外貌描述
2. product_reveal 和 cta 依然建议使用 "product_image"
3. hook 和 demo 可以使用 "ai_generate" 生成人物场景
4. 也可将 visualSource 设为 "user_upload"，让用户上传自己拍摄的真人素材
5. 如果没有真人素材，建议只在中景/远景使用 AI 人物，避免面部特写（容易失真）

建议：如果用户没有真人素材，优先考虑切换到"产品特写"或"场景演示"模式`,
};

// ==================== Platform SEO Strategy ====================

/** Algorithm optimization directives keyed by distribution platform */
export const PLATFORM_SEO_DIRECTIVES: Record<string, string> = {
  douyin: `
【抖音算法优化策略】
完播率优化（权重最高）：
- 前3秒必须有强钩子，不能用品牌logo或空镜头开场
- 每5秒要有一个信息密度高点（新信息、反转、视觉刺激）防止用户划走
- 结尾不要有"谢谢观看"之类的结束信号，要在高潮处戛然而止或抛出悬念
- 配音语速建议 3.5-4 字/秒，比日常略快

互动率优化：
- 在 voiceover 中自然植入 1-2 个引导互动的话术：
  "你们觉得值不值？评论区告诉我"
  "用过的姐妹扣1，没用过的扣2"
  "先收藏，下次买的时候不迷路"
- CTA 分镜的文案要有紧迫感："最后XX件"、"今天下单送XX"

转化率优化：
- 价格锚点要明确：先说原价/柜台价，再说活动价
- 最后 3 秒必须有清晰的购买引导："点击下方小黄车"
- 避免出现绝对化用语（"最好的"、"第一"）可能被限流`,

  kuaishou: `
【快手算法优化策略】
完播率优化：
- 快手用户更喜欢"接地气"的内容，开头用日常场景切入
- 语速可以略慢于抖音（3-3.5字/秒），更有"聊天感"
- 视频时长建议 20-40 秒（快手完播率权重比抖音更高）

互动率优化：
- 快手用户互动意愿强，多用"老铁们"、"家人们"等称呼
- 引导评论："这个价格你们能接受吗？"
- 引导关注："关注我，每天给你们找好物"

转化率优化：
- 快手用户价格敏感度高，性价比是核心卖点
- 多用"自用款"、"回购N次"等信任话术
- CTA 要简单直接："直接拍，不用犹豫"`,

  xiaohongshu: `
【小红书算法优化策略】
完播率优化：
- 小红书用户偏好"精致感"和"教程感"
- 开头用"分享"、"安利"、"测评"等小红书原生词汇
- 视频节奏可以比抖音慢，注重画面美感

互动率优化：
- 引导收藏："建议先收藏，需要的时候翻出来看"
- 引导评论："你们还想看什么类型的测评？"
- 用"姐妹"、"宝子"等小红书风格称呼

转化率优化：
- 小红书用户信任"真实分享"，避免过度营销感
- 多分享使用体验和对比，少说"赶紧买"
- 封面要精致，标题用关键词（品牌名+品类+核心卖点）`,

  shipinhao: `
【视频号（微信）算法优化策略】
社交推荐（视频号最大特点）：
- 视频号靠"朋友点赞/在看"进入社交推荐流，开头 3 秒要能让人愿意转发给朋友、家人群
- 内容偏信任感与实用价值，避免硬广腔；真实、接地气、可信度高的更易被转发
- 完播 + 转发（转发权重高于点赞）是核心信号

生态联动与转化：
- 可引导关注视频号、跳转关联公众号看长图文/领券
- 直播预约 + 视频号小店挂车承接转化；口播自然引导"点下方小店"
- 中老年与下沉人群占比高，语速可稍慢、卖点讲清楚、价格与实惠说透

合规：字幕全程在屏；AI 生成内容打标识，避免夸大与未经证实的功效宣称`,

  tiktok: `
【TikTok Shop 算法优化策略】
官方推荐三段式结构（更易进推荐、提转化）：
- 黄金 3-6 秒钩子：第一帧即产品或惊艳效果，开门见山抛痛点/反差，不留缓冲、不放 logo 空镜
- 核心信息（Key Message）：3-5 个利益点快速给到，每点配一个画面，讲清"为什么是它"
- 明确 CTA：片尾清晰引导"点击橱窗/黄车下单"，可叠加限时优惠

高转化四范式（任选其一贯穿全片）：
- 测评（Review）：真实试用 + 优缺点，建立可信度
- 前后对比（Before/After）：使用前 vs 使用后的可视化反差
- 开箱（Unboxing）：拆封惊喜 + 细节特写，营造期待
- 教程（How-to）：手把手演示用法/场景，降低决策门槛

留存与合规：
- 节奏更快：每 2-3 秒切一个信息点，字幕全程在屏（多为静音观看）
- 价格/优惠用画面贴片强化，别只靠口播
- 面向海外受众时口播可用英文/目标语言；AI 生成内容需打标识，避免夸大与未经证实的功效宣称`,

  reels: `
【Instagram Reels 算法优化策略】
分发与完播：
- 竖屏满屏 9:16，前 2 秒强钩子；Reels 靠 Explore/推荐分发给非粉丝，开场要能拦住陌生人
- 时长偏短更易复看（loop），完播 + 复看是核心信号
- 可借势 trending audio 提升分发（注意商用授权；带货口播为主时音乐压低做背景）

版式与互动：
- 文字避开底部 caption 区与右侧按钮区（点赞/评论/分享/头像），别被 UI 挡住
- 引导 Save（收藏）与 Share（转发）——Instagram 对这两个动作权重高
- 引导点主页链接（link in bio）承接转化，Reels 内不可直接挂链

合规：字幕全程在屏（静音观看为主）；AI 生成内容打标识，避免夸大与未证实功效宣称`,

  shorts: `
【YouTube Shorts 算法优化策略】
留存与复看：
- 竖屏满屏 9:16，前 3 秒留人；结尾能自然接回开头（loop 友好）提升重复播放
- YouTube 兼具搜索属性：标题/口播里自然带核心关键词，利于被搜到与推荐

涨粉与互动：
- Shorts 涨粉是核心目标，片尾自然引导 Subscribe（关注）
- 引导评论互动；标 #Shorts 帮助平台识别为短视频

版式与合规：字幕全程在屏（静音观看）；价格/优惠用画面贴片强化；AI 生成内容打标识，避免夸大与未证实功效宣称`,
};

/** Platform code → human-readable label used in the prompt's "target platform" line. */
const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  xiaohongshu: "小红书",
  shipinhao: "视频号",
  tiktok: "TikTok",
  reels: "Instagram Reels",
  shorts: "YouTube Shorts",
  youtube: "YouTube Shorts",
};

/**
 * Derive a readable "target platform" label from the comma-separated platform codes.
 * Falls back to the common domestic default (抖音/快手) when unset or unrecognized, so the
 * commerce prompt no longer tells the LLM "target: Douyin/Kuaishou" while a TikTok directive is
 * injected — a contradiction that degraded overseas / TikTok Shop output. Pure function.
 */
export function platformTargetLabel(platforms?: string): string {
  if (!platforms) return "抖音/快手";
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of platforms.split(",")) {
    const label = PLATFORM_LABELS[raw.trim().toLowerCase()];
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels.length ? labels.join(" / ") : "抖音/快手";
}

// ==================== Golden-3-Second Strategy ====================

/** Golden-3-second opening strategy library */
export const goldenThreeSecondsStrategies = `
【黄金3秒开头策略 - 必须使用以下策略之一】

策略1「视觉冲击法」：用极度吸睛的画面作为第一帧
  - 夸张的对比（素颜vs妆后、脏vs干净）
  - 动态捕捉（爆浆、拉丝、泼水、碎裂）
  - 微距特写（质地、纹理、光泽）
  示例文案："这个效果真实存在吗？！"

策略2「悬念提问法」：抛出一个让人忍不住要看答案的问题
  - 反常识问题："XX元的东西居然比XX元的好用？"
  - 身份代入："月薪5000的姐妹都在用的XX"
  - 数字钩子："3秒搞定XX，我用了这个方法"
  示例文案："为什么这个XX全网都在抢？"

策略3「反差对比法」：制造强烈的认知反差
  - 价格反差："10块钱 vs 500块钱的XX"
  - 效果反差："同事以为我花了3000做的脸"
  - 身份反差："程序员教你化妆？效果比美妆博主还好"
  示例文案："千万别买贵了！同样的效果只要十分之一！"

策略4「利益承诺法」：直接告诉观众看完能得到什么
  - 省钱："看完这条帮你省500块"
  - 变美/变好："7天让你的XX发生质变"
  - 避坑："买XX前一定要看这条"
  示例文案："看完这条视频，你就知道买哪个了！"

策略5「情感共鸣法」：戳中观众的情感痛点
  - 焦虑共鸣："是不是也觉得XX越来越XX了？"
  - 快乐分享："今天开心到必须分享的一个好物！"
  - 后悔预警："早知道就该买！后悔没早点发现"
  示例文案："姐妹们，别划走！这个XX我后悔没早买！"
`;

/**
 * Retention & conversion hard rules (2026 ad-platform evidence): product visible inside 3s
 * (TikTok Marketing Science: 63% of top-CTR videos show the product/core info in the first 3s),
 * a mid-video re-hook against the 45-55% statistical drop-off window, dual CTA placement
 * (~70% first mention + final-shot repeat with a pointing gesture — voice+gesture+caption
 * triple sync), soft personal-experience urgency by default (fabricated scarcity is an ad-law
 * violation), and an optional save-hook for list/tutorial content. Injected after the hook
 * guidance in buildUserPrompt; commerce path only (the topic path has no product/CTA).
 */
export const RETENTION_CONVERSION_RULES = `【留人与转化硬规则】
- 商品前3秒入画：第一个分镜的画面里必须出现商品实体（前3秒不亮商品的带货视频，大盘点击率显著更低）
- 中段续命钩：总时长超过 20 秒时，在约 40%–60% 进度的分镜台词里安排一句「续命句」，重新开一个悬念（如「但真正离谱的是下面这个」「第三个点才是我下单的原因」），压平中段流失
- CTA 双落位：CTA 不能只在最后一镜——在约 70% 进度的分镜台词里先顺口提一次行动引导；最后一镜复读 CTA，且该镜 description 写明人物手指向画面下方的动作（口播+手势同步）
- 紧迫感分档：默认用「个人体感式软紧迫」（如「我买的时候是这个价，不知道能挂多久」）；「最后X件/仅限今天」类可证实硬促，只有商家确认真实时才能写（虚假紧迫违广告法）
- CTA 前欠一个小钩：CTA 落位时必须还欠观众一个未兑现的小悬念（如「链接里那个赠品才是重点」），不得刚兑现完最大爽点就上转化——爽点结清的瞬间观众就划走了
- 收藏钩（可选）：清单/教程类内容在 CTA 前垫一句给收藏理由（如「先收藏，回头照着买」）`;

// ==================== Output Format Constraints ====================

/** JSON output format constraint prompt */
export const OUTPUT_FORMAT_PROMPT = `
【输出格式要求】
请严格按照以下 JSON 格式输出，不要包含任何 markdown 代码块标记或额外文字：

{
  "title": "脚本标题（10字以内，抓人眼球）",
  "totalDuration": 25,
  "characters": [
    {
      "id": "char_a",
      "name": "角色名（如：小美）",
      "gender": "female",
      "persona": "一句话性格（如：毒舌闺蜜，嘴狠心软）",
      "appearance": "外观锚：清爽耐看的普通人+发型+服装+年龄段+一个随身状态锚（如：32岁有亲和力、松散低马尾带碎发、日常淡妆、浅色居家服、左手腕套着用旧的发圈）——状态锚是袖口/扣子/随身小物这类可比较细节，全片不变；少写\"气质好\"类形容词评价"
    }
  ],
  "shots": [
    {
      "shotId": 1,
      "type": "hook",
      "duration": 3,
      "description": "画面描述：要足够具体，包含场景布置、人物动作、物品位置、光线氛围等细节",
      "camera": "镜头运动描述（从下方运镜词表中选择或微调，如：镜头围绕主体缓慢环绕半圈，高光沿表面流动）",
      "visualSource": "ai_generate",
      "transition": "direct_concat",
      "voiceover": "配音文案：口语化的播音文案，控制字数与duration匹配（约3字/秒）",
      "prompt": "英文AI生图/生视频prompt：用于生成该分镜的视觉素材",
      "searchTerms": ["english keyword", "alt keyword"],
      "characterId": "出镜人物ID（可选，有人物出镜时填写）"
    }
  ],
  "seo": {
    "title": "视频标题（含核心关键词，15字以内）",
    "hashtags": ["#话题标签1", "#话题标签2", "#话题标签3"],
    "coverText": "封面文案（8字以内，吸引点击）",
    "interactionGuide": "互动引导语（引导评论/收藏/关注）",
    "description": "视频描述文案（含关键词，50字以内）"
  }
}

字段规则：
- shotId: 从1开始递增的整数
- type: 只能是 "hook" | "pain_point" | "product_reveal" | "demo" | "social_proof" | "cta" 之一
- duration: 该分镜时长（秒），所有分镜 duration 之和应等于 totalDuration
- description: 中文画面描述，要具体到可以直接拍摄或让AI生成；只写"这一秒画面里谁在做什么"的可见事实（详见下方可生成性判据）
- camera: ${cameraPresetGuide()}
- visualSource: "ai_generate"（AI生成）| "product_image"（使用商品图）| "user_upload"（用户上传）
- transition: "ai_start_end" | "ai_reference" | "direct_concat" | "ffmpeg_fade"
- voiceover: 中文配音文案，字数约等于 duration x 3；可在一处自然换气点写 [pause]（每镜至多 1 处，可不用）——它只做配音气口，不会出现在字幕里，不占字数
- prompt: 英文 prompt，用于 AI 图像/视频生成，描述画面主体、风格、光线、构图等
- searchTerms: 1-3 个英文检索词，描述该分镜画面主体（用于从免费素材库自动搜画面，无商品主题成片时尤其关键），如 ["coffee morning", "cozy cafe"]
- characterId: 如果该分镜有人物出镜，填入人物ID；无人物的分镜省略此字段
- characters: 仅剧情类脚本（情景短剧等有角色对话的风格）需要输出；gender 只能是 "female" | "male"；非剧情脚本省略此字段或输出空数组
- seo.title: 包含商品名和核心卖点的短标题
- seo.hashtags: 3-5个相关话题标签，第一个为品类大标签
- seo.coverText: 封面上叠加的大字文案
- seo.interactionGuide: 自然的互动引导话术
- seo.description: 发布时的视频描述

【画面动作可生成性（description/prompt 硬判据——AI 视频模型拍不出的动作，写了就是废镜）】
禁四类写法：
1. 两个主体同时做精确配合的交互（对抛接物、击掌碰杯特写）→ 拆成两镜，或改成一方主导另一方静态
2. 内部心理状态（"想起了""意识到""犹豫要不要"）→ 换成可见的外化动作（动作停住、视线移开、手指敲了两下桌面）
3. 否定式动作（"没接住""不理他"）→ 写实际发生的画面（手停在半空、转头看向窗外）
4. 一拍内三步以上的手部动作链（拧盖-倒出-涂抹-拍打）→ 只保留一步主动作，其余拆镜或交给台词/音效交代
改写顺序（发现拍不出时依次尝试）：换动作承担者 → 拆成两镜 → 改成停留/定格 → 交给台词或音效

【分镜设计三硬规则】
1. 商品关键动作只允许一个"主落实镜"：动作只在这一镜完整发生，前面的分镜不得提前出现动作完成后的状态（前一镜出现拆开的包装、后一镜再拍拆包装=穿帮）
2. 相邻两镜至少变一项：景别 / 机位角度 / 人物关系，连续两镜同景别同机位会像卡帧
3. 景别由信息决定：这一镜必须被看清的信息在哪个尺度，景别就选哪个尺度（看质地→微距特写；看动作→中景；看氛围→全景）

注意事项：
1. 第一个分镜的 type 必须是 "hook"，最后一个必须是 "cta"
2. totalDuration 控制在15-30秒之间
3. 分镜数量控制在5-8个
4. prompt 字段要用英文，风格描述要专业（如 cinematic, soft lighting, macro shot 等）
5. visualSource 为 "product_image" 时，prompt 字段可省略
`;

// ==================== Product Analysis Prompt ====================

/** Product image analysis prompt */
export const PRODUCT_ANALYSIS_PROMPT = `你是一位专业的电商选品分析师。请仔细分析提供的商品图片，提取以下信息：

1. 【商品识别】
   - 商品名称/类型
   - 所属品类（美妆护肤/食品零食/家居日用/服饰鞋包/数码3C）
   - 品牌（如果可见）

2. 【视觉特征】
   - 主色调和配色方案
   - 包装设计风格（简约/华丽/可爱/科技感等）
   - 产品形态（固体/液体/粉末/组合等）
   - 材质质感（哑光/亮面/透明/磨砂等）

3. 【卖点提取】
   - 从图片可见的产品卖点（成分、功效、规格等）
   - 包装上的营销文案
   - 产品独特的设计亮点
   - 卖点三硬约束：每条不超过15字；一条只讲一个维度（材质/功效/价格/场景不混写）；禁"品质好""性价比高"类空泛词，必须落到可感知的具体细节

4. 【目标用户推断】
   - 根据产品特征推断目标用户群体
   - 适合的使用场景
   - 可能的痛点和需求

5. 【短视频建议】
   - 推荐的拍摄角度和特写镜头
   - 建议突出的视觉元素
   - 适合的脚本风格（痛点种草/场景安利/对比测评/剧情故事）

请用 JSON 格式输出分析结果：
{
  "productName": "商品名称",
  "category": "beauty|food|home|fashion|tech",
  "brand": "品牌名（未知则留空）",
  "visualFeatures": {
    "mainColor": "主色调",
    "designStyle": "设计风格",
    "productForm": "产品形态",
    "texture": "材质质感"
  },
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "targetAudience": "目标用户描述",
  "usageScenarios": ["场景1", "场景2"],
  "painPoints": ["痛点1", "痛点2"],
  "videoSuggestions": {
    "recommendedAngles": ["角度1", "角度2"],
    "keyVisuals": ["视觉元素1", "视觉元素2"],
    "suggestedStyle": "pain_point|scene|comparison|story|drama|reversal|interview|unboxing|product_pov|talking_head"
  }
}`;

// ==================== Assemble Full Prompt ====================

/** Input parameters for script generation */
export interface ScriptGenerationInput {
  /** product name */
  productName: string;
  /** product category */
  category: ProductCategory;
  /** product description / selling points */
  productDescription?: string;
  /** script style */
  styleType: ScriptStyleType;
  /** target duration in seconds */
  targetDuration?: number;
  /** target audience */
  targetAudience?: string;
  /** product image analysis result */
  productAnalysis?: string;
  /** video mode */
  videoMode?: "product_closeup" | "graphic_montage" | "scene_demo" | "live_presenter";
  /** user-defined custom requirements */
  customRequirements?: string;
  /** reference script structure (shot pacing/type/conversion logic from a viral template, used for "apply template" generation) */
  referenceStructure?: string;
  /** on-screen character info (live_presenter mode only; injected into prompts to maintain character consistency) */
  character?: {
    id: string;
    name: string;
    appearance: string;
    voiceStyle?: string;
  };
  /** price range */
  priceRange?: string;
  /** distribution platforms (comma-separated: douyin,kuaishou,xiaohongshu) */
  platforms?: string;
  /** product usage and advantages */
  usageAdvantage?: string;
  /** performance-feedback directive (data flywheel): pre-rendered hint that biases style/hook toward what historically converts; empty when there is no data */
  performanceHint?: string;
  /** pin the opening hook mechanism (HOOK_PATTERNS id) — anti-homogenization batch rotation assigns a different one per video */
  preferredHookId?: string;
}

/**
 * Assembles the full user prompt
 * Combines all templates, strategies, and constraints into a single generation instruction
 */
export function buildUserPrompt(input: ScriptGenerationInput): string {
  const {
    productName,
    category,
    productDescription,
    styleType,
    targetDuration = 25,
    targetAudience,
    productAnalysis,
    videoMode = "product_closeup",
    customRequirements,
    character,
    priceRange,
    platforms,
    usageAdvantage,
    performanceHint,
    preferredHookId,
  } = input;

  // fetch category templates
  const categoryData = getTemplatesByCategory(category);
  const categoryName = categoryNameMap[category];

  // fetch style directive
  const styleDirective = styleType === "custom"
    ? `【脚本风格：自定义】\n请根据用户的自定义要求来确定脚本结构和风格。`
    : stylePrompts[styleType];

  // pick the best-fit reference template (use the first one)
  const referenceTemplate = categoryData.templates[0];

  // assemble prompt
  const parts: string[] = [];

  parts.push(`请为以下商品创作一条电商短视频带货脚本：`);
  parts.push(`\n【商品信息】`);
  parts.push(`- 商品名称：${productName}`);
  parts.push(`- 商品品类：${categoryName}`);

  if (productDescription) {
    parts.push(`- 商品描述/卖点：${productDescription}`);
  }

  if (targetAudience) {
    parts.push(`- 目标用户：${targetAudience}`);
  }

  if (priceRange) {
    parts.push(`- 价格区间：${priceRange}`);
  }

  if (usageAdvantage) {
    parts.push(`- 用法与优势：${usageAdvantage}`);
  }

  parts.push(`- 目标总时长：${targetDuration}秒`);
  parts.push(`- 画面比例：9:16 竖屏（手机观看）`);
  // Reflect the actual distribution platforms (defaults to 抖音/快手 when unset) instead of a fixed
  // domestic label — otherwise a TikTok / overseas target contradicts the injected platform strategy.
  parts.push(`- 目标平台：${platformTargetLabel(platforms)}`);

  // append product image analysis result
  if (productAnalysis) {
    parts.push(`\n【商品图片分析结果】`);
    parts.push(productAnalysis);
  }

  // inject on-screen character constraints
  if (character) {
    parts.push(`\n【出镜人物】`);
    parts.push(`- 人物名称：${character.name}`);
    parts.push(`- 外貌特征：${character.appearance}`);
    if (character.voiceStyle) {
      parts.push(`- 声音风格：${character.voiceStyle}`);
    }
    parts.push(`- 重要：所有包含人物出镜的分镜，prompt 中必须包含该人物的外貌描述，确保画面一致性`);
    parts.push(`- 在 shot 的 characterId 字段填入 "${character.id}"`);
  }

  // append video mode directive
  parts.push(`\n${VIDEO_MODE_DIRECTIVES[videoMode]}`);

  // inject platform SEO strategy
  if (platforms) {
    const platformList = platforms.split(",");
    // use the first platform as the primary optimization target
    const primaryPlatform = platformList[0];
    if (PLATFORM_SEO_DIRECTIVES[primaryPlatform]) {
      parts.push(`\n${PLATFORM_SEO_DIRECTIVES[primaryPlatform]}`);
    }
    if (platformList.length > 1) {
      parts.push(`\n【注意】视频同时投放于：${platformList.join("、")}，脚本要兼顾各平台用户习惯`);
    }
  }

  // append category-specific directive
  parts.push(`\n${categoryData.directive}`);

  // append style directive
  parts.push(`\n${styleDirective}`);

  // append performance feedback (data flywheel): real published-video conversion data biases
  // the chosen style + opening hook; empty string when the creator has no metrics yet (cold start)
  if (performanceHint) {
    parts.push(`\n${performanceHint}`);
  }

  // append golden-3-second hook guidance (category-preferred patterns + three-beat structure);
  // a pinned hook id (batch anti-homogenization rotation) narrows it to one mandatory mechanism
  parts.push(`\n${buildHookGuidance(category, 5, preferredHookId)}`);

  // append retention & conversion rules (mid-video re-hook, dual CTA placement, soft urgency)
  parts.push(`\n${RETENTION_CONVERSION_RULES}`);

  // append reference template
  parts.push(`\n【参考脚本案例（仅供参考风格和节奏，不要照搬内容）】`);
  parts.push(`模板名称：${referenceTemplate.name}`);
  parts.push(`参考示例：\n${referenceTemplate.example}`);

  // append custom requirements
  if (customRequirements) {
    parts.push(`\n【用户额外要求】`);
    parts.push(customRequirements);
  }

  // append output format constraints
  parts.push(`\n${OUTPUT_FORMAT_PROMPT}`);

  // Language follows the product info language: English products (overseas TikTok Shop/Amazon)
  // should produce English scripts/voiceovers; otherwise the OUTPUT_FORMAT's "Chinese voiceover"
  // instruction would cause English products to output Chinese narration (wrong video body).
  // Placed last for maximum prominence, overrides any "中文" wording in the spec above.
  // Same technique used in the topic path (buildTopicPrompt).
  const productText = `${productName || ""} ${productDescription || ""} ${usageAdvantage || ""}`;
  if (productText.trim() && !/[一-鿿]/.test(productText)) {
    parts.push(
      `\n【LANGUAGE — IMPORTANT, overrides any "中文" wording above】The product info is NOT in Chinese. Write every "title" and "voiceover" field in the SAME language as the product (e.g. natural English for an overseas TikTok Shop audience), never Chinese. Keep "searchTerms" in English as usual; "description"/"camera" may be concise English.`
    );
  }

  return parts.join("\n");
}

/**
 * Builds a batch generation prompt (generates multiple scripts with different styles in one call)
 */
export function buildBatchPrompt(input: ScriptGenerationInput, count: number = 3): string {
  const basePrompt = buildUserPrompt(input);

  const refBlock = input.referenceStructure
    ? `\n\n【参考爆款结构】\n请参考以下经过验证的高转化分镜结构（镜头类型、节奏、转化逻辑），用本商品重新创作脚本（不要照搬文案，要贴合本商品卖点）：\n${input.referenceStructure}\n`
    : "";

  return `${basePrompt}${refBlock}

【批量生成要求】
请生成 ${count} 个不同风格/角度的脚本方案。每个方案的切入角度、开头策略、叙事节奏都要有明显差异。

输出格式改为：
{
  "scripts": [
    { "title": "...", "totalDuration": ..., "shots": [...] },
    { "title": "...", "totalDuration": ..., "shots": [...] }
  ]
}

请确保输出 ${count} 个脚本方案。`;
}

// ==================== Topic Video (product-free) ====================
//
// "One-line topic video": the user provides only a one-line topic (e.g. "how to brew pour-over
// coffee at home", "the romance of city nights"). No product is involved; the engine produces a
// short-video script with voiceover and shot pacing, each shot carrying English search keywords
// (stockKeywords), which stock-fill then uses to source footage from free libraries → compose video.
// Difference from commerce scripts: no product/selling points/purchase pressure;
// visualSource is ai_generate throughout (backed by free stock footage); expression over conversion.

/** System role for topic videos: general short-video content director (knowledge/lifestyle/story/emotion) */
export const TOPIC_SYSTEM_PROMPT = `你是一位顶级短视频内容编导，擅长把任意一个主题做成有画面、有节奏、让人看完有收获或有共鸣的竖屏短视频。

【核心能力】
1. 黄金3秒：用悬念、反差、利益承诺或情绪共鸣在前3秒留住观众
2. 信息节奏：把主题拆成层层递进的小信息点，每个分镜只讲一件事，不堆砌
3. 画面感：每个分镜都能对应到一段真实可检索的画面（风景、动作、物件、场景）
4. 旁白口语化：像朋友聊天，不书面、不说教，配音字数与时长匹配（约3字/秒）
5. 收尾升华：结尾用一句金句或行动建议收束，给观众"值得点赞收藏"的理由

【创作原则】
- 这是一条没有商品的内容向短视频，不要出现任何带货、卖点、价格、下单、购买引导
- 每个分镜的画面都要能用免费素材库搜到，所以画面主体要常见、具象、可拍摄
- 画面里不强求出现人脸，优先用环境/动作/物件/风景表达
- searchTerms 必须用英文，描述该分镜的画面主体，是自动配画面的关键，绝不能省略

【输出要求】
你必须严格按照指定的 JSON 格式输出，不要输出任何额外的解释文字。`;

/** Narration style for topic videos */
export type TopicNarrationStyle = "knowledge" | "story" | "lifestyle" | "inspiration" | "travel";

/** Display name mapping for narration styles */
export const topicNarrationNameMap: Record<TopicNarrationStyle, string> = {
  knowledge: "知识科普",
  story: "情感故事",
  lifestyle: "生活方式",
  inspiration: "励志金句",
  travel: "旅行风光",
};

/** Creative directives for each narration style */
const topicStylePrompts: Record<TopicNarrationStyle, string> = {
  knowledge: `
【旁白风格：知识科普】
- 开头抛出一个反常识或让人好奇的问题/事实
- 中间用 3-5 个递进的小知识点把主题讲清楚，每个分镜一个点
- 语言准确但不掉书袋，多用"其实""你可能不知道"等口语连接
- 结尾给一句可记住的总结金句`,
  story: `
【旁白风格：情感故事】
- 用第一人称或第二人称叙事，开头是一个有代入感的瞬间
- 中间有情绪起伏（铺垫→转折→释然），让观众跟着走
- 画面以氛围、光影、生活细节为主，烘托情绪
- 结尾落到一句能引发共鸣的感悟`,
  lifestyle: `
【旁白风格：生活方式】
- 像一段精致的生活 vlog 旁白，娓娓道来
- 展示一个具体的生活场景/流程/习惯的美好瞬间
- 画面注重质感与细节（手部动作、物件特写、自然光）
- 结尾是一句温柔的生活态度表达`,
  inspiration: `
【旁白风格：励志金句】
- 节奏明快有力，每个分镜一句短而有冲击力的话
- 用对比、排比制造气势，画面大气（风光、奔跑、登顶、城市）
- 不空喊口号，结合具体画面让情绪落地
- 结尾一句点题的金句，适合被点赞收藏`,
  travel: `
【旁白风格：旅行风光】
- 以目的地或风景为主角，旁白像一封写给某个地方的信
- 画面是地标、自然、人文细节的组合，节奏舒缓
- 旁白点出这个地方独特的氛围与值得去的理由
- 结尾留一句让人想出发的话`,
};

/** Output format constraints for topic videos (reuses the Shot structure but removes product/purchase pressure, and requires searchTerms on every shot) */
const TOPIC_OUTPUT_FORMAT_PROMPT = `
【输出格式要求】
请严格按照以下 JSON 格式输出，不要包含任何 markdown 代码块标记或额外文字：

{
  "title": "脚本标题（10字以内，抓人眼球）",
  "totalDuration": 25,
  "shots": [
    {
      "shotId": 1,
      "type": "hook",
      "duration": 3,
      "description": "中文画面描述：这一镜呈现什么画面（场景/动作/物件/光线），要具体可检索",
      "camera": "镜头运动描述：特写/中景/全景 + 推拉摇移",
      "visualSource": "ai_generate",
      "transition": "direct_concat",
      "voiceover": "中文旁白文案，字数约等于 duration × 3",
      "searchTerms": ["english keyword", "alt keyword"]
    }
  ]
}

字段规则：
- shotId: 从1开始递增的整数
- type: 第一个分镜用 "hook"，中间分镜用 "demo"，最后一个用 "cta"（此处表示收尾升华，不是带货）
- duration: 该分镜时长（秒），所有分镜 duration 之和应等于 totalDuration
- description: 中文画面描述，具体到可以直接检索或拍摄
- camera: 中文镜头运动描述
- visualSource: 固定为 "ai_generate"
- transition: "direct_concat" | "ffmpeg_fade" 之一（主题成片节奏明快，建议这两种）
- voiceover: 中文旁白文案，字数约等于 duration × 3
- searchTerms: 【必填】1-3 个英文检索词，精准描述该分镜画面主体，如 ["pour over coffee", "coffee beans closeup"]。每个分镜都必须有，否则无法自动配画面

注意事项：
1. 第一个分镜 type 必须是 "hook"，最后一个必须是 "cta"（收尾升华）
2. totalDuration 控制在 15-40 秒之间
3. 分镜数量控制在 5-9 个
4. 全程不得出现任何商品、卖点、价格、购买/下单引导
5. 每个分镜的 searchTerms 都不能省略，用常见、具象的英文词以保证素材库能搜到画面
`;

/** Input for topic video script generation */
export interface TopicScriptInput {
  /** one-line topic */
  topic: string;
  /** narration style, defaults to knowledge */
  narrationStyle?: TopicNarrationStyle;
  /** target duration in seconds, defaults to 25 */
  targetDuration?: number;
  /** distribution platforms (comma-separated), used to inject platform SEO strategy (optional) */
  platforms?: string;
  /** additional user requirements (optional) */
  customRequirements?: string;
}

/** Assembles the user prompt for topic video generation */
export function buildTopicPrompt(input: TopicScriptInput): string {
  const {
    topic,
    narrationStyle = "knowledge",
    targetDuration = 25,
    platforms,
    customRequirements,
  } = input;

  const styleDirective = topicStylePrompts[narrationStyle] ?? topicStylePrompts.knowledge;

  const parts: string[] = [];
  parts.push(`请围绕以下主题创作一条竖屏短视频脚本（这是一条没有商品的内容向视频）：`);
  parts.push(`\n【主题】\n${topic}`);
  parts.push(`\n【基本要求】`);
  parts.push(`- 旁白风格：${topicNarrationNameMap[narrationStyle] ?? "知识科普"}`);
  parts.push(`- 目标总时长：${targetDuration}秒`);
  parts.push(`- 画面比例：9:16 竖屏（手机观看）`);

  // narration style directive
  parts.push(`\n${styleDirective}`);

  // golden-3-second strategies (shared with commerce scripts; opening hook logic is universal)
  parts.push(`\n${goldenThreeSecondsStrategies}`);

  // platform SEO (optional, use first platform)
  if (platforms) {
    const primary = platforms.split(",")[0];
    if (PLATFORM_SEO_DIRECTIVES[primary]) {
      parts.push(`\n${PLATFORM_SEO_DIRECTIVES[primary]}`);
    }
  }

  if (customRequirements) {
    parts.push(`\n【用户额外要求】\n${customRequirements}`);
  }

  parts.push(`\n${TOPIC_OUTPUT_FORMAT_PROMPT}`);

  // Language follows the topic language: English topics should produce English voiceovers/titles
  // (otherwise the "Chinese voiceover" wording in the JSON spec above would cause English topics
  // to produce Chinese narration — wrong video body). Placed last for maximum prominence,
  // overrides any "中文" wording in the spec.
  if (!/[一-鿿]/.test(topic)) {
    parts.push(
      `\n【LANGUAGE — IMPORTANT, overrides any "中文" wording above】The topic is NOT in Chinese. Write every "title" and "voiceover" field in the SAME language as the topic (e.g. natural English), never Chinese. Keep "searchTerms" in English as usual; "description"/"camera" may be concise English.`
    );
  }

  return parts.join("\n");
}

/** Batch-generates multiple topic video scripts with different angles */
export function buildTopicBatchPrompt(input: TopicScriptInput, count: number = 3): string {
  const basePrompt = buildTopicPrompt(input);
  return `${basePrompt}

【批量生成要求】
请生成 ${count} 个不同切入角度的脚本方案，每个方案的开头钩子、叙事顺序、画面选择都要有明显差异。

输出格式改为：
{
  "scripts": [
    { "title": "...", "totalDuration": ..., "shots": [...] },
    { "title": "...", "totalDuration": ..., "shots": [...] }
  ]
}

请确保输出 ${count} 个脚本方案，且每个分镜都带 searchTerms。`;
}

// ==================== Backward-Compatible Legacy Interface ====================

/**
 * Legacy script prompt builder (kept for backward compatibility)
 * @deprecated Use buildUserPrompt instead
 */
export function buildScriptPrompt(params: {
  productName: string;
  productCategory?: string;
  productDescription?: string;
  productAnalysis?: string;
  styleType: string;
  duration: number;
  templateHint?: string;
}): string {
  const category = mapOldCategory(params.productCategory);

  return buildBatchPrompt({
    productName: params.productName,
    category,
    productDescription: params.productDescription,
    productAnalysis: params.productAnalysis,
    styleType: (params.styleType as ScriptStyleType) || "pain_point",
    targetDuration: params.duration,
    customRequirements: params.templateHint,
  });
}

/** Maps legacy category names to new category keys */
function mapOldCategory(category?: string): ProductCategory {
  if (!category) return "beauty";
  const map: Record<string, ProductCategory> = {
    "美妆护肤": "beauty",
    "食品零食": "food",
    "家居日用": "home",
    "服饰鞋包": "fashion",
    "数码3C": "tech",
  };
  return map[category] || "beauty";
}
