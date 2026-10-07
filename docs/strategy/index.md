# 策略研究

「策略研究」页（`/strategy`）用来维护**你自己的投资纪律**：写完的条目会被 pi 读到，作为分析时的背景。

## 数据在哪

**service SQLite 的 `strategies` 表是唯一真源**（前端点击即发 HTTP，不再写浏览器 IndexedDB）。

| 操作 | 前端调用 | 服务端 |
|---|---|---|
| 列表 | `GET /api/strategies` | `userDataService.listStrategies()`（启用优先 + 更新时间倒序） |
| 新建 / 更新 | `POST` / `PUT /api/strategies[/:id]` | 写 SQLite |
| 启用开关 | `PUT /api/strategies/:id { active }` | `active` 为 1/0 |
| 删除 | `DELETE /api/strategies/:id` | 真删 |

前端薄封装：`frontend/src/db/strategyMemory.ts`（导出签名与迁移前一致，内部转发 HTTP），
写成功后派发 `gofund:strategies-changed`，页面监听刷新。

## 字段含义

| 字段 | 说明 |
|---|---|
| `title` | 标题（≤40 字，列表里显示） |
| `content` | 正文：投资目标、资金分配、买卖纪律、风险管理 |
| `tags` | 标签数组（页面上按逗号展示） |
| `active` | **是否启用**：1 = 参与分析背景，0 = 先放着不用 |
| `source` | `manual`（手写）或 `ai-draft`（pi 起草） |

> 说明：迁移前 `active = 1` 的策略会被拼成一段文本注入前端 AI 的提示词
> （`buildStrategyContext()`）。前端 AI 删除后**这条注入链已不存在**（函数与测试一并删除），
> 现在由 pi 通过 `list_strategies` 工具读原始条目自己判断，所以 `active` 依然有意义。

## 谁在用它

| 角色 | 怎么用 |
|---|---|
| 页面 | 增删改查 + 启用开关 |
| pi（终端） | `list_strategies` 读 → 结合行情/回测给建议 → 用户确认 → `save_strategy` 写回（带确认令牌） |
| 未来的分析 | 任何新分析入口都应先读启用中的条目，再谈结论 |

pi 侧的完整流程（含确认令牌怎么用）见 [pi 工具面](/architecture/pi-tools) 与
`.pi/skills/gofund-strategy/SKILL.md`。
