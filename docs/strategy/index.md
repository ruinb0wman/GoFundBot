# 策略研究

「策略研究」页（`/strategy`）用来维护**你自己的投资纪律**：写完的条目会被 pi 读到，作为分析时的背景。

## 数据在哪

**策略记忆是一个 markdown 文件夹**（路径在「策略研究」页右上角「文件夹」里设置，落 SQLite `settings` 的 `strategy.dir`）。
一条策略 = 一个 `.md` 文件：frontmatter 存元数据，正文就是策略内容。

```markdown
---
id: 3
title: 稳健定投计划
tags: [定投, 长期持有]
active: 1
source: manual
createdAt: 2026-08-01T02:00:00.000Z
updatedAt: 2026-10-30T06:12:00.000Z
---

每月 15 号投 2000，跌破 MA250 加码……
```

- **`id` 在 frontmatter 里是标识，文件名随意**：改名、改标题都不影响识别（标题改了不会重命名文件）。
- 直接把普通 `.md` 丢进文件夹也能用：`title` 取首个 `# 标题`、没有就取文件名；缺 `id` 时**读的时候自动补写**回文件。
- 未知的 frontmatter 键（比如 Obsidian 的 `cssclasses`）写入时原样保留。
- **删除不真删**：文件移到 `<文件夹>/.trash/<原名>.<时间戳>.md`，读取时忽略。
- 文件夹**默认为空（未配置）**：此时列表为空、新建/写入返回 400，页面会提示先去设置。
- 首次配置文件夹时，旧 SQLite `strategies` 表里的策略会被**一次性导出**成 md（`id` 原样保留）；之后不再读表。

| 操作 | 前端调用 | 服务端 |
|---|---|---|
| 列表 | `GET /api/strategies` | `strategyStore.listStrategies()`（现读磁盘；启用优先 + 更新时间倒序） |
| 新建 / 更新 | `POST` / `PUT /api/strategies[/:id]` | 原子写对应的 md（临时文件 + rename） |
| 启用开关 | `PUT /api/strategies/:id { active }` | 重写该文件的 frontmatter |
| 删除 | `DELETE /api/strategies/:id` | 移到 `.trash/` |
| 配置文件夹 | `GET/PUT /api/settings` 的 `strategy.dir` | 建目录 + 校验可写 + 首轮导出 |

前端薄封装：`frontend/src/db/strategyMemory.ts`（`listStrategies` + 文件夹的 `fetchStrategyDir` / `saveStrategyDir`），
写成功后派发 `gofund:strategies-changed`，页面监听刷新；页面另在窗口 focus 与「刷新」按钮时重读磁盘（外部编辑器改完即生效）。

> ⚠️ **确认令牌变软了**：文件夹是你的文件系统，pi 用 bash/编辑器直接改 md 会绕过 `save_strategy` 的确认令牌。
> 令牌只约束工具面（页面与工具同一个入口），不是文件锁。

## 字段含义

| 字段 | 说明 |
|---|---|
| `title` | 标题（≤40 字，列表里显示） |
| `content` | 正文：投资目标、资金分配、买卖纪律、风险管理 |
| `tags` | 标签数组（页面上按逗号展示） |
| `active` | **是否启用**：1 = 参与分析背景，0 = 先放着不用 |
| `source` | `manual`（手写）或 `ai-draft`（pi 起草） |

这些都存在 md 的 frontmatter 里；`content` 是 frontmatter 之后的正文。

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
