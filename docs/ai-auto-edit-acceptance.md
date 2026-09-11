# AI 自动剪辑开发与验收记录

日期：2026-09-08。状态：功能实现、本地验收和一条真实素材的云端模型验收均已完成。尚未提交或推送本次代码。

## 实现范围

- 新入口：素材剪辑创建页默认进入 AI 自动剪辑；旧手动剪辑页可切换。工作台路径为 `/project/{id}/auto-edit`。
- 单条视频最长 300 秒、最大 1GB；目标 15／20／30 秒，成片实际时长不得超过目标或 30 秒。旧导入的 2 小时和旧引导剪辑的 45 秒限制保持原有行为。
- 24 个均匀采样点与最多 12 个场景切换点；支持模型按需补查最多 3 个区间。画面与转写带原始时间戳，分析结果按素材哈希、模型配置和版本缓存。
- 服务端独立进程执行 Whisper ASR。首次下载开源模型，之后使用本地缓存；无需浏览器持续打开。纯静音返回空转写，时间戳限制在真实音频内。
- 文本模型调用受控工具，图片输入交给画面理解模型。支持原生工具协议及 JSON 动作兼容协议；模型不接触 Shell、文件路径或 FFmpeg 参数。
- 精确原视频区间裁剪、重排、完整画面／裁切填满、0.85–1.15 倍速、直接切换／短淡化。原声强制正常速度，并拒绝在转写语句内部剪切。
- 原声、新旁白、静音、中文字幕或英文字幕、本地配乐。旁白按生成音频的实际时长校验，过长则要求修改计划；不通过强行截尾满足时长限制。原声与旁白使用直接切换以保护语句边界。
- 默认 720p；1080p 导出复用保存的时间线与旁白文件，不重新调用内容模型。素材哈希变化或原旁白文件丢失时拒绝静默替换。
- 保存任务状态、心跳、执行所有权、检查点、历史版本、取消、重试与中断恢复。相同请求 ID 幂等，失败重试保留原操作类型。
- 按需最多 3 个候选方案，选择后生成新版本；支持手动编辑与自然语言修改。成功采用后关闭父任务的待处理状态。
- 成片执行解码、时长、尺寸、音轨检查及黑帧／冻结检测，再由理解模型复核抽帧。每轮任务最多 24 次实际模型 HTTP 请求、40 次旁白请求、初次渲染加 2 轮修正，整体 30 分钟上限。
- 任务中心、播放器、下载、历史版本与中英文界面已接入。API Key 不持久化到任务表。

## 代码位置

| 模块 | 文件 |
| --- | --- |
| 公共契约与时间线 | `src/lib/auto-edit/contract.ts` |
| 采样及本地转写 | `src/lib/auto-edit/media.ts`、`scripts/auto-edit-asr.mjs` |
| 模型与工具协议 | `src/lib/auto-edit/model.ts` |
| 任务编排与恢复 | `src/lib/auto-edit/runner.ts` |
| 渲染及技术检查 | `src/lib/auto-edit/render.ts` |
| 工作台 | `src/components/auto-edit-workspace.tsx` |
| 任务接口 | `src/app/api/project/[id]/auto-edit/route.ts` |
| 数据迁移 | `drizzle/0022_auto_edit.sql` |

## 自动化测试

新增 4 个 AI 自动剪辑测试文件，共 30 项测试；加入任务中心回收站过滤回归后，全仓库 138 个测试文件、1,282 项测试全部通过。

| 文件 | 核验内容 |
| --- | --- |
| `auto-edit.test.ts` | 输入／输出限制、素材归属、非法区间与参数、帧时间线、语句边界、原声字幕、工具白名单、视频上传边界 |
| `auto-edit-model.test.ts` | 原生工具 schema、JSON 降级、401 不降级、理解模型路由、共享预算、非法动作 |
| `auto-edit-runner.test.ts` | 真实 SQLite 迁移、幂等、发布事务、跨项目隔离、取消、过期心跳恢复、所有权、防重复执行、手动操作及导出重试、渲染上限、素材哈希变化 |
| `auto-edit-render.test.ts` | 真实 FFmpeg 裁剪重排、三种画幅、中文字幕、淡化、原声、1080p、30 秒边界、配乐、变速、取消及原文件哈希不变 |

以上文件位于 `src/lib/__tests__/`。任务和协议测试使用可控模型响应，不能作为真实模型语义能力的证明。

复现命令（Windows）：

```powershell
.\node_modules\.bin\vitest.CMD run
.\node_modules\.bin\tsc.CMD --noEmit
npm run build
node --check scripts/auto-edit-asr.mjs
node --check scripts/accept-auto-edit.mjs
```

修改的 TS／TSX 文件通过 ESLint；生产构建成功。构建仍有一条 NFT 追踪范围警告，指向已有的 `src/app/api/ingest/product/route.ts` 导入链。没有将此警告计为“无警告构建”。本次修复了 ASR 原生 DLL 的追踪缺失，并实际运行 standalone 中的 ASR 脚本验证。

## 本地 HTTP 端到端验收

运行开发服务后执行：

```powershell
node scripts/accept-auto-edit.mjs
```

脚本在本机启动模拟模型及 TTS 服务，创建单独测试项目，上传 FFmpeg 生成的 32 秒测试图案视频，实际经过数据库、HTTP 接口、模型适配器和本地 FFmpeg。不会使用用户原视频、真实 API Key 或云端 AI；测试旁白是合成提示音，用来检验音轨与时间线。

已验证：

1. 静音版：12 秒、720p、技术检查通过。
2. 配音版：12 秒、720p、旁白时长校验与音轨检查通过。
3. 1080p 导出：12 秒、时间线与配音版一致，导出期间模型调用数不增加。
4. 3 个不同素材区间的候选方案；选用第二个后保存新版本，父任务转为已采用。
5. 模型原生工具返回 400 时，自动切换 JSON 动作协议并完成任务。
6. 原始测试素材 SHA-256 不变。

最新验收项目：`db87a489-57d2-4fba-9e53-9cebb19f883e`。

- 页面：`http://localhost:3000/project/db87a489-57d2-4fba-9e53-9cebb19f883e/auto-edit`
- 机器记录：`data/acceptance/auto-edit/http-acceptance.json`
- 样片：`data/output/db87a489-57d2-4fba-9e53-9cebb19f883e/`

浏览器已检查中文／英文切换、候选比较、历史版本切换、播放器、下载入口、时间线展开和编辑／取消；已恢复中文。浏览器中展示的是合成素材验收样片。

## 本地 ASR 与打包验证

使用 [Hugging Face 官方 Node 音频处理教程](https://huggingface.co/docs/transformers.js/tutorials/node-audio-processing) 提供的公开 `jfk.wav` 样本，转换为 16kHz 单声道 float32 PCM 后运行 Whisper。开发环境和 standalone 脚本均完成本地转写，返回时间区间 0–11 秒及对应英文语句。纯静音样本返回 `[]`。

```powershell
node scripts/auto-edit-asr.mjs data/acceptance/auto-edit/jfk.f32 data/acceptance/auto-edit/asr-jfk.json data/cache/asr en
node .next/standalone/scripts/auto-edit-asr.mjs data/acceptance/auto-edit/jfk.f32 data/acceptance/auto-edit/asr-standalone.json data/cache/asr en
```

这里验证了 Windows 上的本地推理及 standalone 依赖，未执行安装器构建，也未声称已完成 macOS/Linux 安装包验收。中文转写参数已接入，中文语音准确率仍需代表性真实素材验证。

## 真实模型与真实素材验收

用户已明确授权将现有理发店视频的采样画面、必要转写和剪辑要求发送到已配置的 OpenRouter 服务。使用文本模型 `deepseek/deepseek-v4-flash` 和画面理解模型 `bytedance-seed/seed-2.0-lite`；任务设置为最长 15 秒、9:16、静音并开启字幕。API Key 未写入任务、数据库或验收文档。

实际任务：

- 项目：`28e5086d-717e-43c8-bff5-261e91fc2b4f`
- 任务：`b730075a-8a68-4f38-8359-81ca9d57220d`
- 原片：11.233 秒、720×1280、有音轨
- 成片：8.666667 秒、720×1280、H.264、30fps、无音轨
- 状态：`done`；技术问题、内容复核问题均为空
- 方案：3 个硬切镜头，依次展示调整发丝、顾客对镜记录新造型、卷发成品展示

画面理解能够识别人物、动作与场景变化，最终字幕“造型师精心调整发丝”“对镜记录新造型”“大波浪卷发 蓬松自然”均可由对应画面直接验证，没有生成价格、优惠、店名或效果承诺。成片按每个计划镜头的输出中点逐一取样检查，三个镜头均实际出现在输出中。源视频 SHA-256 在渲染后保持不变，页面可正常显示完成状态、播放器、下载和 1080p 导出入口。

真实运行发现并修复了三个编排问题：

1. 原生工具调用结果此前只进入压缩上下文，没有作为标准 `tool` 消息回复，导致模型反复读取素材索引。现在保存 assistant tool call 与对应 tool result，并将素材索引设为一次性工具。
2. 原先用整段成片的均匀抽帧可能跳过短镜头，造成错误的“镜头缺失”判断。现在每个计划镜头至少在其输出中点取样，并明确区分输出时间和原片时间。
3. 模型在内容复核通过后仍可能重复调用 `inspect_output`。现在按计划、渲染、检查和完成阶段动态收紧可用工具；复核通过后只允许完成或请求必要输入。

阶段工具白名单与标准工具回传已加入自动化回归测试。该真实样片证明当前 OpenRouter 配置可以完成画面理解、计划、实际裁剪、字幕与内容检查，但只覆盖一条 11.2 秒竖屏理发素材和静音策略。中文 ASR 准确率、保留原声的语句边界效果、真实配音服务、多分钟素材及其他内容类型仍需分别用代表性素材验收。
