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

1. 从 OpenRouter 实时模型目录选择可计价的文本与视觉模型；价格在 Session 启动时固化为快照。
2. 真实模型 8 案例开发集校准；案例仅来自 Smoke 与 Dev，API Key 与模型选择只保存在当前标签页的 `sessionStorage` 中，关闭标签页后清除，不写入磁盘、评测 Session、Trace 或报告。
3. 正式评测使用单独的 sealed Holdout；全部案例完成人工金标准复核，且同一模型组合通过与当前代码、数据及评分器版本一致的开发集校准后才能开始。
4. 正式评测、逐案例进度、确定性评分与动态报告；评测 Session 可在页面刷新或开发工具重启后恢复。

## 命令行入口

```bash
pnpm eval:agent:smoke
pnpm eval:agent:test
pnpm eval:agent:report -- --session=<calibration-session-id>
```

默认成本停止线为 6 美元，绝对上限为 7 美元。8 案例开发集校准使用独立的 0.75 美元硬上限。启动正式评测前页面会再次要求确认预算。

## 目录

```text
tools/agent-eval/
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
