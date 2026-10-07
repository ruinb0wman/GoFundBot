---
name: gofund-strategy
description: 读取、分析并更新 GoFundBot 应用「策略记忆」（/strategy 页面）里的用户投资策略，改完在 bow 浏览器里打开该页面给用户查看。当用户说「我的策略」「帮我看看现有策略」「改进/更新我的定投策略」「打开策略页面」时使用。需要行情/基金数据配合分析时，与 gofund-data 技能一起用。
---

# GoFundBot 策略记忆（读 + 写）

策略记忆的真源是 **service 的 SQLite**（`service/data/gofund.db` 的 `strategies` 表，P2 迁移过来的；
浏览器 Dexie 只留着旧副本，前端经 `/api/strategies` 走 HTTP）。

| 工具 | 用途 |
|---|---|
| `list_strategies` | 读出全部策略 |
| `save_strategy` | 更新（带 `id`）或新建一条策略（**写操作，需确认**） |

两个工具都由 `.pi/extensions/gofund/` 提供（service HTTP 桥，清单来自 `/api/agent/tools`）。
**没有任何浏览器桥了**（`gofund-app` 扩展与 `window.__gofund` 已在 P5 删除）——
要给用户看页面就自己调 bow 的 MCP 工具，见文末。

`save_strategy` 的确认由 service 强制：第一次调用只返回 `__confirm_token` 不落库，
用户同意后用**完全相同的参数** + 令牌重调才写入（令牌一次有效）。

## 标准流程（用户要「分析并改进策略」时）

1. `list_strategies` —— 先拿到**真实**的现有策略（不要凭记忆或猜测）。记下每条 `id`。
2. 需要行情依据时用 `gofund-data` 的工具（`get_market_indices` / `get_hot_sectors` / `get_fund_*`），
   让建议落在当下市场而不是泛泛而谈。
3. **在对话里给出改进方案**：逐条说明问题 → 给出改进后的**完整**标题/正文/标签，并标明是
   修改哪一条（`id`）。**不要在这时说已经改了。**
4. 等用户明确确认（「确认」「改吧」「可以」）。用户要调整就先改方案再确认。
5. `save_strategy` —— 第一次调用会返回 `confirm_required` + `__confirm_token`：
   把要写入的内容展示给用户（第 3 步已展示过就引用一下），得到确认后带令牌**原样重调**。
   更新用 `id`，新建则省略 `id`（来源自动记「AI 起草」）。
6. 用户想亲眼看页面时，用 bow 的工具把它切到前台（见文末「给用户看页面」）。
7. 回报改动：哪条、改了哪些字段、是否启用。

## 硬约束

- **没有用户确认，绝不去拿/不去用确认令牌。** `save_strategy` 是唯一会改用户数据的工具；
  service 会用令牌把「确认」变成机制，但**别把机制当形式**：没跟用户确认过就不要调第二次。
- 要改的是**已有策略**时必须带 `id`（来自 `list_strategies`）；不要新建一条近似重复的策略，
  除非用户就是想新建。
- 写进去的正文要**能真正影响 AI**：注入链路只取 `active === 1` 的策略，最多 5 条，
  标题截 40 字、正文截 600 字、合计 3000 字（`db/strategyMemory.ts` 的 `buildStrategyContext`）。
  所以：正文第 1 句就要写清核心纪律，别把关键约束埋在 600 字之后；超过 5 条启用策略时，
  多的不会进提示词。
- `active` 是「是否参与 AI 分析」的开关，不是存档标记。用户说「先放着别用」就传 `active: false`。
- 标签是字符串数组，界面上按逗号显示——不要塞进正文。
- 工具报错时**如实转述**，别编造「已保存」：
  - `service 没起来`（`list_strategies` / `save_strategy`）→ 让用户 `cd service && bun run dev`。
  - 打开页面失败（bow 没起 / 没有 `browser_*` 工具）不影响写入结果 —— 如实说「已保存，但没能在浏览器里打开页面」。

## 边界（如实说，别假装能做）

- 数据在 **service 的 SQLite**：不论用户在哪个浏览器/Electron 壳里看页面，读到的都是同一份（前端走 HTTP）。
- 只能改**策略记忆**。回测方案（`/backtest` 的策略代码）与自选股没有工具；持仓有只读的 `get_positions`。
- 没有删除工具（破坏性）；要删让用户在页面上删（`DELETE /api/strategies/:id` 也存在于 service，但没有对应工具）。

## 给用户看页面（用 bow 的 MCP 工具）

pi 里通常有 bow 的 `browser_*` 工具；把 GoFundBot 前端页面亮出来给用户看：

```
browser_list_tabs                       # 已有 http://localhost:8517 标签 → 记下 id
browser_switch_tab { tabId }            # 切到前台（等价于原来 gofund_strategy_open）
# 没开的话：
browser_new_tab { url: "http://localhost:8517/#/strategy", waitUntil: "none" }
```

注意：`browser_new_tab` **不要用 `waitUntil: 'load'`** —— Vite 冷启动常超过它 15s 的超时（标签其实已经建好）。
前端没起就如实说 `cd frontend && bun run dev`，不要谎称已打开。

## 降级：工具不可用时

`list_strategies` / `save_strategy` 不在工具列表里（扩展未加载 / 项目未授信 / service 没起）时，
直接调 service 的 HTTP 接口也可以，但**写操作同样要先经用户确认**：

```
curl -s localhost:8310/api/strategies                       # 读
curl -s -X POST localhost:8310/api/strategies -H 'content-type: application/json' \
     -d '{"title":"…","content":"…","tags":[],"active":1}'  # 写（用户确认后）
```

（`POST /api/agent/call` 才是带确认令牌的那条路；直接打 REST 路由就绕过了令牌，所以更要守住「先问用户」。）
