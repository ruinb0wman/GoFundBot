---
name: gofund-strategy
description: 读取、分析并更新 GoFundBot 应用「策略记忆」（/strategy 页面）里的用户投资策略，改完在 bow 浏览器里打开该页面给用户查看。当用户说「我的策略」「帮我看看现有策略」「改进/更新我的定投策略」「打开策略页面」时使用。需要行情/基金数据配合分析时，与 gofund-data 技能一起用。
---

# GoFundBot 策略记忆（读 + 写）

策略记忆的真源是 **service 的 SQLite**（`service/data/gofund.db` 的 `strategies` 表，P2 迁移过来的；
浏览器 Dexie 只留着旧副本，前端经 `/api/strategies` 走 HTTP）。

| 工具 | 用途 |
|---|---|
| `list_strategies` | 读出**全部**策略（含停用的） |
| `save_strategy` | 更新（带 `id`）或新建一条策略（**写操作，需确认**） |
| `delete_strategy` | 删除一条策略（**破坏性写入，需确认**） |

三个工具都由 `.pi/extensions/gofund/` 提供（service HTTP 桥，清单来自 `/api/agent/tools`）。
**没有任何浏览器桥了**（`gofund-app` 扩展与 `window.__gofund` 已在 P5 删除）——
要给用户看页面就自己调 bow 的 MCP 工具，见文末。

`save_strategy` / `delete_strategy` 的确认由 service 强制：第一次调用只返回 `__confirm_token` 不落库，
用户同意后用**完全相同的参数** + 令牌重调才写入（令牌一次有效，参数差一个字符就要重走确认）。

写操作全量覆盖：`save_strategy` 的 `title` 与 `content` **都是必填**，所以哪怕只想把某条改成停用，
也得把标题和**全文原样**带上（漏了就把正文清空/重置）。

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
   要删条目用 `delete_strategy(id)`，同样需要先把标题给用户看过并确认。
   （`save_strategy` 的 `title` ≤ 40 字是 Zod 硬限制，超了直接 400。）
6. 用户想亲眼看页面时，用 bow 的工具把它切到前台（见文末「给用户看页面」）。
7. 回报改动：哪条、改了哪些字段、是否启用。

## 硬约束

- **没有用户确认，绝不去拿/不去用确认令牌。** `save_strategy` 与 `delete_strategy` 是仅有的两个会改
  用户数据的工具；service 会用令牌把「确认」变成机制，但**别把机制当形式**：没跟用户确认过就不要调第二次。
- 要改的是**已有策略**时必须带 `id`（来自 `list_strategies`）；不要新建一条近似重复的策略，
  除非用户就是想新建。
- **没有任何自动注入链路**：`buildStrategyContext`（把启用策略拼进提示词的那套）已随前端 AI 在 P6 删除。
  `list_strategies` 返回全部策略（服务端按「启用优先 + 更新时间倒序」排序），参考哪条由你自己判断。
  `active` 现在只影响**排序**和页面上那个「启用」标记——页面文案写的「供 AI 参考」已无实际消费方，
  别把它当注入开关向用户解释。
- 正文**没有字数硬限**（只有 `title` ≤ 40 字被 Zod 卡）。但正文越长，你读它、用户核对它都越费劲：
  建议一条控制在千字以内、**第 1 句就写清核心纪律**，别用「一、二、三」目录式抬头开头。
  **最常见的坑是聊天残渣**：标题里带「标题：」、正文重复标题、正文结尾留着对用户的反问
  （「你想现在定，还是先存这版？」）—— 这些都要在写之前清掉。
- `active` 语义是「这条我还在用」，不是存档标记：用户说「先放着别用」就传 `active: false`。
  注意 **更新时省略 `active` 等于传 `true`**（service 侧是 `active === false ? 0 : 1`）——
  只改正文时别顺手把停用的策略重新启用。
- 标签是字符串数组，界面上按逗号显示——不要塞进正文。
- 工具报错时**如实转述**，别编造「已保存」：
  - `service 没起来`（`list_strategies` / `save_strategy`）→ 让用户 `cd service && bun run dev`。
  - 打开页面失败（bow 没起 / 没有 `browser_*` 工具）不影响写入结果 —— 如实说「已保存，但没能在浏览器里打开页面」。

## 边界（如实说，别假装能做）

- 数据在 **service 的 SQLite**：不论用户在哪个浏览器/Electron 壳里看页面，读到的都是同一份（前端走 HTTP）。
- 本技能只管**策略记忆**。回测方案（`list_strategy_scripts` / `save_strategy_script` / `delete_strategy_script` / `run_strategy_code`）
  与自选（`add_to_watchlist` 等）各有自己的工具，属于 `gofund-data` 面 —— 用户没让改就别在本流程里顺手动。
  持仓有只读的 `get_positions`。
- 删除用 `delete_strategy(id)`（破坏性，需确认令牌）——「没有删除工具、只能让用户在页面上删」是旧信息。

## 给用户看页面（用 bow 的 MCP 工具）

pi 里通常有 bow 的 `browser_*` 工具；把 GoFundBot 前端页面亮出来给用户看：

```
browser_list_tabs                       # 已有 http://localhost:8517 标签 → 记下 id
browser_switch_tab { tabId }            # 切到前台（等价于原来 gofund_strategy_open）
# 没开的话（必须传 windowId: 1 + activate: true，否则标签会开在另一个窗口里、用户看不到）：
browser_new_tab { url: "http://localhost:8517/#/strategy", windowId: 1, activate: true, waitUntil: "none" }
```

注意：
- `browser_new_tab` **不要用 `waitUntil: 'load'`** —— Vite 冷启动常超过它 15s 的超时（标签其实已经建好）。
- `windowId` 从 `browser_list_tabs` 的 `windowId: 1`（`windowRole: "user"`）取；不传会开在 MCP 专属窗口里，亮不到用户面前。
- 想确认页面真的渲染了新数据，用 `browser_eval { tabId, code }` 读页面（例如统计
  `.memory-item` 与「N 个启用 · M 个总计」）——比截图省事。

前端没起就如实说 `cd frontend && bun run dev`，不要谎称已打开。

## 降级：工具不可用时

`list_strategies` / `save_strategy` / `delete_strategy` 不在工具列表里（扩展未加载 / 项目未授信 / service 没起）时，
直接调 service 的 HTTP 接口也可以，但**写操作同样要先经用户确认**：

```
curl -s localhost:8310/api/strategies                       # 读（信封：{"success":true,"data":{"items":[...]}}）
curl -s -X POST localhost:8310/api/strategies -H 'content-type: application/json' \
     -d '{"title":"…","content":"…","tags":[],"active":1}'  # 新建（用户确认后）
curl -s -X PUT  localhost:8310/api/strategies/2 -H 'content-type: application/json' \
     -d '{"content":"…"}'                                 # 更新（REST 是部分更新，可只传要改的字段）
curl -s -X DELETE localhost:8310/api/strategies/2            # 删除（用户确认后）
```

（`POST /api/agent/call` 才是带确认令牌的那条路；直接打 REST 路由就绕过了令牌，所以更要守住「先问用户」。）
