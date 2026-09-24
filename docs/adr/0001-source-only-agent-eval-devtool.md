---
status: accepted
---

# Agent Eval 作为源码级开发工具

Mora Agent Eval 放在 `tools/agent-eval/`，只供源码二次开发和实验使用，不注册 Mora 产品路由、不进入侧边栏，也不随普通用户安装包提供。Mora 自动剪辑模块只暴露少量通用 seam：可选的 `AutoEditObserver`、执行调度器与交互策略；产品运行时不包含 evaluation 专属 lane 或枚举。评测工具作为 adapter 注入 Trace、成本、并发调度和无人值守策略，从而同时保持产品运行时纯净与开发者评测能力可复用。

评测创建的项目使用通用 internal-project 标记。所有产品跨项目聚合统一通过一个可见性条件排除 internal projects；标记不承载评测状态机或评测业务逻辑。

## Consequences

评测界面由独立 loopback 服务提供；开发者需要显式运行 `pnpm eval:agent:devtool`。评测数据集与代码可版本化，大体积素材和实验结果仍保留在 Git 忽略目录。

自动剪辑运行时与评测数据集共享同一组安全预算常量。总模型调用上限覆盖素材分析、Agent 决策、补充视觉检查和成片复核；评测不得再用低于运行时的隐含阈值把已经完成的成片判为失败。成本控制仍由会话美元停止线、单次请求上限和渲染上限共同执行。

开发集校准只允许读取 Smoke 与 Dev 数据；正式 Baseline 只允许读取未参与开发调试的 sealed Holdout。校准门禁绑定模型组合、数据集内容、评测器版本和自动剪辑运行时代码指纹。流程与技术硬门禁和内容事实一致性必须分开报告，`needs_review` 不能绕过成片存在、解码和视频流检查。
