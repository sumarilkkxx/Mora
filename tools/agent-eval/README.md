# Mora Agent Eval Devtool

这是 Mora 源码仓库附带的开发者评测工具，不是 Mora 产品功能。

- 普通用户安装或运行 Mora 时，不会看到评测页面、评测路由或侧边栏入口。
- 二次开发者可以从源码启动独立工具，评测 `src/lib/auto-edit/` 的 Agent 行为。
- Mora 运行时只提供可选的 `AutoEditObserver` seam；未注入 observer 时行为与开销不变。
- 数据集、成本账本、Trace、评分器、报告和人工复核界面均属于本目录。
- 大体积素材与实验结果保存在被 Git 忽略的 `.scratch/`、`evals/agent/results/` 中。

## 启动开发工具

```bash
pnpm eval:agent:devtool
```

默认地址为 `http://127.0.0.1:3100`。可用 `MORA_EVAL_PORT` 修改端口。工具只监听 loopback，不向局域网开放。

页面提供：

1. 快速八条、类别/标签/指定案例/历史失败定向选择、完整 64 条开发回归；启动前验证冻结素材与协议 hash，展示重复次数与证据模式。
2. 当前 OpenRouter 的可计价文本/视觉模型选择，以及有界会话停止线、单请求上限、并发和超时。API Key 仅留在页面内存和当前请求中，刷新清除；sessionStorage 仅保存非敏感配置和当前运行 ID。
3. 实时进度、取消、历史和显式继续未完成项。刷新/服务重启不会自动发起模型请求；预算中止、未完成与未知费用分别显示。
4. 自动报告、参考选择/更换、全部重复尝试、双方协议和条件差异、实际执行回执与受限媒体播放。人工标签可完全跳过；负面评价只需问题标签，不强制长说明。

开发回归默认停止线 $0.100、单请求 $0.010；可在页面修改，服务不会放宽输入上限。受控媒体/固定故障协议不需要模型调用。自然素材必须明确模型与预算，再点击启动。本轮只有 OpenRouter 远端适配；其他 Provider 明确拒绝，不静默替换。

旧 Smoke/Dev/Holdout 文件、校准门禁和历史报告保留；新页面是开发回归入口，不依赖旧盲测或人工门禁。历史区只读旧 summary，缺少新字段显示未记录。未来正式质量基线仍需独立 sealed Holdout 与既有复核隔离。

## 命令行入口

```bash
pnpm eval:agent:smoke
pnpm eval:agent:test
pnpm eval:agent:report -- --session=<calibration-session-id>
```

上述 smoke/report 为旧兼容入口；旧独立批处理的 $6/$7 和校准 $0.75 上限不适用于新开发回归页面。

## 目录

```text
tools/agent-eval/
  ui/            # 本地三入口、证据和可选标签；无 CDN
  regression/    # 冻结选择、持久化控制器、比较/标签/API/受限媒体
  testing/       # 显式离线注入；不注册普通服务或产品 Provider
  core/          # Case、Trace、CostLedger、Scorer 与批处理
  datasets/      # 可版本化的数据集 manifest 与人工标注
  sources/       # 来源清单；不包含大体积媒体
  calibration.ts # 真实 Mora Agent 校准编排
  evaluation-session.ts # 可恢复的 Calibration / Holdout Session 与门禁
  model-catalog.ts # OpenRouter 模型能力与价格快照
  session-results.ts # 动态评分与报告
  server.ts      # 独立 localhost 开发者界面
  run-fixed.ts   # 零成本固定响应 Smoke
  report.ts      # 从 Trace、SQLite 与媒体输出生成报告
```

流程与技术硬门禁不等于内容质量。`pending-human-review` 数据、已暴露给开发流程的 Holdout，以及未经独立复核的成片不得作为正式 Baseline、最终质量或简历结论。

## 开发回归基础合同

新的案例 manifest 支持 `schemaVersion: 2`：八个主类别、独立素材 lineage、完成/请求补充/停止预期、原声、检查依据及容差、可控 fixture/fault 配置。现有 v1 数据和历史结果仍可读取；64 条回归集与三入口调度已接入，当前页面直接使用 64 条开发回归集。

评测器 v3 记录实际工具执行回执，保留失败重试，并验证成片对应的渲染、检查和发布关系。缺少回执的历史 trace 标为未评价；重新检查的报告保存为 `summary-rechecked-v3.md`，保留原 `summary.md`。人工评阅不参与这些自动评分。

视频证据使用真正的完整解码，支持尺寸、时长、音轨/峰值以及受控画面参考检查。`frame_match` 只适用于有 hash、采样时间和容差的已知素材或字幕区域；它不提供任意视频的 OCR、审美或内容语义评分。检查结果和输出 hash 保存到运行目录 `media-evidence-v3/`。固定响应、真实媒体和真实模型的证据需分别解释。

### 开发回归真实素材池（schema v2）

`datasets/regression-base.json` 包含 product/process/service/difficult 四类各八条，共 32 个基础案例。`sources/regression-real-v1.json` 冻结原始与 prepared 文件 hash、来源页面/作者、来源组、元信息和任务依据。原始文件与去静音派生只计一个素材；同一作者组存在相关样本，不能把 32 条当成 32 个独立泛化样本。联系表仅用于核对任务合理性，`visibleFacts` 留空、人工标注保持 pending；通用字幕/语义事实不宣称自动通过。

旧 Smoke/Dev/Holdout 文件与历史报告保持原样。新池以 parentCaseId 与 retired_holdout/exposure 记录迁移，属于已暴露开发数据，不授予盲测资格、不依赖旧人工门禁。短素材的目标时长是上限，禁止循环冒充新镜头，可输出真实长度并进入复核。

离线预检（缺源立即报错，不 skip）：

```bash
node node_modules/tsx/dist/cli.mjs tools/agent-eval/prepare-real-sources.ts
```

在另一 checkout 恢复资产时，先恢复原始文件或显式加 `--prepare --download`（访问 manifest 中的 Pexels 下载地址）；去静音仅流复制。下载/派生结果必须匹配冻结 hash，FFmpeg 版本变化导致 hash 不一致需核对，不能自动更新 manifest。大媒体与预检报告留在忽略目录。

`datasets/regression-constraints.json` 增加画幅时间/声音字幕各八条。素材是固定种子 0 的三段色带、边缘标记、440Hz 原声、880Hz 旁白替代音；不声称自然语音识别或真实 TTS 能力。使用 Mora renderer 生成已知正例和违反单项要求的反例，均保存输出 hash/参数/FFmpeg 版本。frame_match 对受控裁剪、顺序与字幕区域采样；audio_match 只对已知声音窗口比较 8kHz PCM，不是通用音频相似度或全片原声保证。字幕字体依赖本地 renderer 的字体解析，字体/工具变更引起 hash 漂移必须显式审查。

```bash
# 重新生成、验证正反例及冻结 hash；默认不会改 manifest
node node_modules/tsx/dist/cli.mjs tools/agent-eval/prepare-constraint-fixtures.ts
# 重建一个代表，使用临时目录且保留原有冻结媒体
node node_modules/tsx/dist/cli.mjs tools/agent-eval/prepare-constraint-fixtures.ts --case=caption-copy
```

维护者仅在审查生成器/版本变化后使用 `--write-manifest` 更新快照。缺 FFmpeg/字体或媒体即报错，不将 skip 记为通过。

### 冻结的 64 条清单与执行协议

`datasets/regression.json` 恰好 64 条、八类各八条；`regression-protocols.json` 冻结顺序、每类一个快速代表、组件 hash 和每例执行协议。`loadRegressionDataset()` 验证组件/来源/oracle 身份、合成父案例、模式与交互策略。新开发集直接读取，不调用历史 sealed-Holdout 门禁。三入口、预算调度与页面共享该冻结清单。

本版协议分三种可用模式，启动时必须逐例披露，不能静默替换：32 条自然素材要求配置真实模型；16 条约束案例执行真实 renderer 的 `real_media` 协议；16 条故障案例执行固定响应驱动真实持久化 runner 的 `fixed_response` 协议。后两组没有付费模型质量结论，也没有承诺故障自动注入可用于任意 Provider。跨 64 条的单一“真实模型全量通过”目前没有证据。

```bash
# 重建坏输入派生，真实完整解码必须拒绝它
node node_modules/tsx/dist/cli.mjs tools/agent-eval/prepare-fault-source.ts
# 确定性故障协议执行全部 16 场景，附带全局取消验证
MORA_FAULT_EVIDENCE=evals/agent/fault-runner-proof.json node node_modules/vitest/vitest.mjs run --config tools/agent-eval/vitest.config.ts tools/agent-eval/__tests__/fault-runner.test.ts
# 定向执行一个场景（ID 后缀）
node node_modules/vitest/vitest.mjs run --config tools/agent-eval/vitest.config.ts tools/agent-eval/__tests__/fault-runner.test.ts -t invalid-plan
```

故障 scope 是单个隔离内存 DB 运行，adapter 在指定工具边界/次数触发；验证先发生真实操作，再读实际状态/回执，脚本不从 expected.requiredTools 构造成功 trace。恢复案例的模型与媒体 IO 受控，runner 逻辑断言通过单独报告，成片媒体评价保持 unknown；停止/必要补充根据真实终态、原因和不发布行为评价。局部固定响应解析错误可恢复，其请求账单已知为零；不把它当作外部 Provider 超时/未知费用的恢复保证。

64 是任务数；自然输入有 32 个原始素材/22 个作者组，新增受控视频只来自一个合成来源家族，静音与坏输入为派生。多变体及相关来源不用于独立样本的泛化置信区间。协议、来源与代码改变需要新的运行和比较记录，不覆盖旧实验。

### 持久化开发回归 API

新开发控制器独立于旧 calibration/Holdout 门禁。Loopback 服务提供：

- `POST /api/regression/preview`：`selection` 为 quick/full 或 targeted（categories/tags/caseIds/historicalFailures）；过滤维度取交集，维度内取并集；seed 固定顺序，repetitions 按 caseId 设置 1–20。
- `POST /api/regression/sessions`：selection、configuration、临时 apiKey。configuration 必须明确 provider、textModel、visionModel、stopLimitUsd（$0.001–100）、maxRequestCostUsd（不大于停止线）；可设 concurrency（1–4）、timeoutMs（1秒–1小时）。服务不会增加预算。
- `GET /api/regression/sessions` / `GET /api/regression/sessions/:id`：持久化历史/状态/完整 attempts 与证据。
- `POST /api/regression/sessions/:id/cancel`：停止排队，尽力 abort 在途请求；确认费用与未知账单预约分别保留。
- `POST /api/regression/sessions/:id/continue`：显式给出新 configuration 与临时 apiKey；新关联运行只补未完成 attempt，保留其 repetition 和 previousAttemptId。

`evals/agent/regression-results/:id/` 保存冻结案例/协议、代码内容指纹、独立 attempt 与原始证据。预算预约在请求前同步落盘；重启将活动会话终结为 interrupted，未结算预约标为 uncertain，不发起自动重试。人工复核状态不参与运行门禁。

32 条自然素材使用 real_model；16 条受控约束通过实际 renderer 使用 real_media（合成旁白不代表真实 TTS）；16 条故障使用 fixed_response，执行隔离 SQLite 的实际 runner 测试，媒体未验证仍为 unknown。不会隐式替换证据模式。当前真实模型计价适配仅支持 OpenRouter；其他 provider 会明确拒绝，模型选择不强制绑定品牌。离线本地 Provider 注入只供工程测试，不代表已支持任意远端平台。

参考比较：`POST /api/regression/sessions/:id/reference` 接收 `referenceSessionId`；更换时保留选择历史和双方选择/协议/价格/代码指纹快照。`GET /api/regression/sessions/:id/report` 输出自动概览、共同/新增/缺失案例、可比较性原因、新增失败/恢复/持续失败、全部 repetition、单独费用/耗时和未评价分母，每份 JSON 报告另存。Agent 内容指纹变化允许比较；案例/素材/评分规则/协议/证据模式变化不做配对结论；Provider/模型/预算变化提示条件差异。旧缺字段 session 显示 not recorded，读取不改写原始记录。人工未评不会阻塞报告。

可选人工评价：`GET /api/regression/sessions/:id/reviews` 读取当前记录和修改历史；`POST` / `PUT` 同路径仅接收 `scope`、`attemptId`、`verdict`、`labels`、`severity`、`atSeconds`、`note`。默认 scope=attempt；session 级标签用 scope=session，不计入 attempt 覆盖率。无参考 verdict 为 usable/needs_changes/unusable/unknown，有参考为 better/same/worse/unknown。负面评价必须有 requirements/facts/editing_audio/captions_copy 至少一标签；blocking/improvement 严重度可选，不强制长说明。时间点为非负有限秒数（最多3600秒；已观测输出时不得超出时长），说明最多2000字符。

评价存入独立 `human-reviews.json`，保留修改历史，不修改 session 自动事实或预算。参考偏好绑定选择时的 referenceSessionId；更换参考后保留原记录，报告标出评价上下文并只统计适用于当前参考的覆盖率。所有未评、部分评、无法判断均不影响运行或自动报告。API 拒绝额外字段、凭据字段和明显含密钥的说明。旧缺 attempt 身份的运行不伪造人工绑定。

实际 runner 返回 `budget_exhausted` 时，普通完成任务保留预算中止/未评价及原 trace，纳入手动继续；预期正是合理预算停止的案例仍可按完整证据评价。runner 自身返回取消/中断也保留未完成语义。会话和预算原子写入会同步文件及父目录，持久化失败不会放行模型请求。

## 离线工程验收与复现

先通过冻结资产预检，再在独立终端显式启动测试 harness（结果/SQLite 与日常服务隔离）：

```bash
MORA_EVAL_TEST_ROOT=/tmp/mora-eval-offline-acceptance MORA_EVAL_TEST_PORT=3108 node node_modules/tsx/dist/cli.mjs tools/agent-eval/testing/fixture-server.ts
```

另一个终端执行：

```bash
node tools/agent-eval/testing/browser-acceptance.mjs
node tools/agent-eval/testing/restart-acceptance.mjs
node tools/agent-eval/testing/offline-acceptance.mjs
pnpm eval:agent:test
# 完整仓库包括 jsdom/真实子进程；避免与构建同时高并发争用资源
node node_modules/vitest/vitest.mjs run --maxWorkers=2
pnpm test:desktop
pnpm build
pnpm test:e2e:run
```

测试 harness 仅接受显式 local-fixture，远程 fetch 禁止；`/__fixture/*` 不在普通服务注册。测试脚本内密钥为固定非敏感占位符，不是可用凭据。浏览器使用本机 Chrome/Edge 或 `MORA_E2E_BROWSER_PATH`；沙箱不允许启动浏览器时须在允许启动隔离进程的环境执行，不以缺浏览器 skip 代替验收。完成后 Ctrl+C 关闭测试服务。不要向此 harness 输入真实密钥。

离线完整运行遵循原 64 条证据模式：32 条自然素材通过实际 runner/SQLite/真实本地 HTTP 收到故意无效的分析响应，验证自动失败与已知用量保留；16 条约束重新执行 Mora renderer/FFmpeg；16 条固定故障执行实际 runner 逻辑。另重复 19 次确定性尝试。**这些结果不是 32 条真实模型通过或 64 条质量基线**：故障恢复的受控假媒体仍 unknown，synthetic price 账本不代表真实扣款，外部付费请求为零。输出报告保留预期行为/证据模式/已评与未评价分母，人工记录为零仍能完成。

本轮交付证据在本地 `.scratch/agent-eval-regression/`（Git 忽略）：规格、地图、逐任务 Answer、原始日志、媒体 oracle、浏览器截图和最终验收矩阵。工具/案例 manifest/来源快照可随源码版本化，冻结大素材需单独恢复。发布构建必须继续排除 tools/agent-eval、evals 和 .scratch；standalone 产物及产品 route manifest 均检查其无 Eval 文件/入口。当前 build 的动态文件路径 tracing 警告需要结合实际 payload 检查，不能仅凭编译成功断言隔离。
