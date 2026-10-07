# 启用策略与 pi

> 这一页原本叫「策略记忆与 AI 注入」，描述的是**前端 AI 时代**的提示词注入链路
> （`chatEngine` 技能 + `fundAnalyst` / `portfolioAnalyst` 各注入一次）。前端 AI 已删除，
> 本页改为说明「现在的等价物是什么」。

## 现在的链路

```
用户写策略 (页面) ──HTTP──> SQLite strategies
                                  ▲
                                  │ list_strategies（只读工具）
                                  │ save_strategy + 确认令牌（写工具）
                            终端 pi 会话
                                  │ 结合行情/回测工具给建议
                                  ▼
                            把建议说给用户 → 用户确认 → 写回
```

- **没有自动注入**：pi 不会"后台"读策略，它是在需要时显式调用 `list_strategies`（技能里写明了这个工作流）。
- **`active` 仍是约定**：`active = 1` 表示"这条要参与分析背景"。pi 读到的条目带 `active` 字段，
  技能要求它优先看启用中的条目；`active = 0` 的当作"存档/草案"。
- **不再有字符截断**：迁移前的注入会截断（标题 40 字 / 正文 600 字 / 合计 3000 字，最多 5 条）。
  现在 pi 拿到的是完整条目（`list_strategies` 返回全文），需要控制上下文时由它自己取舍。

## 为什么删掉注入实现

- 注入是"给定提示词模板 + 拼接"，只在固定场景（基金分析/持仓诊断/对话）有意义；
  这些场景随前端 AI 一起删除后，`buildStrategyContext()` / `getActiveStrategies()`
  只剩一个未被任何页面使用的 `buildActiveStrategyContext()` 包装 → 已删除（连同其测试）。
- 反过来，pi 是**通用**的：它可以在任何问题里决定要不要读策略、读哪几条，比固定注入更灵活。

## 相关

- 数据模型与页面：见 [策略研究](/strategy/)
- pi 工具与确认流程：见 [pi 工具面](/architecture/pi-tools)
- 技能文件：`.pi/skills/gofund-strategy/SKILL.md`
