# 回测页 AI 助手「无故中断」——诊断 + 日志 + 健壮性修复

## 0. 目标与范围

**目标**：让 AI 对话在回测场景下的中断变得**可见、可诊断、可恢复**，并修掉几条已确认会导致
「回答停在半途、页面却毫无提示」的代码路径。不新增 UI 结构、不引入取消/停止功能。

**已确认的范围（用户选择）**
- 给 AI 链路加 `clientLogger` 埋点；
- 把静默截断改成可见的 `status`（warn）；
- 给**非流式** LLM 调用加超时；
- 修 `onError`/`onDone` 重复落库与 `trimMessages` 破坏 `tool_calls`/`tool` 配对的 bug。
- 日志落点：复用现有 `clientLogger` → `POST /api/logs/ingest`（LogsViewer 选 `Frontend` 可查）。

**明确不做**：不实现 AbortSignal 取消、不加「停止」按钮、不改 `switchSession` 的取消语义
（这些是「可中断」选项，本次不选）。

**关键既有事实（都已读代码确认）**
- 前端日志管道**已经存在**且完整：`frontend/src/core/logger.ts` 的 `clientLogger` 批量
  `navigator.sendBeacon('/api/logs/ingest')`；`service/src/routes/logs.routes.ts` 的 `/ingest`
  接受 `entries[]` 并写 `frontend-YYYY-MM-DD.jsonl`；`LogsViewer.vue` 有 `Frontend` 源。
  `main.ts` 已调用 `initClientLogger()`。**唯独 AI 链路一次都没调用过 `clientLogger`。**
- 回测页 `BacktestView.vue:14` 内嵌 `<ChatPanel channel="backtest" force-skill="investment_strategy" embedded />`，
  因此 `App.vue` 在 backtest 路由下不挂全局气泡（`ChatBubble v-if route.name !== 'backtest'`），
  不存在双面板抢同一个 chatStore 的问题。中断发生在引擎内部，不在面板挂载。

---

## 1. 根因清单（按证据排序）

### R1 — 流式回答中途断流被**静默吞掉**（最匹配「无故中断」）
`frontend/src/services/chatEngine/index.ts:260-265`
```ts
} catch (error) {
  if (fullContent) {
    yield { event: 'token', data: JSON.stringify({ token: '', full: fullContent }) }
    break          // ← 不 emit error/status，不写日志，直接收尾
  }
  ...
```
只要已经吐过 token，任何流错误（网络断开、`openChatStream` 的 300s abort、provider 提前关连接）
都会走到这里：**保留半截正文、静默 `break`**，随后照常 `yield done`。UI 看起来就是「回答说到一半戛然而止」。

### R2 — 非流式 `chatCompletion` 无超时
`frontend/src/services/llm.ts:150-163` `requestChat()` 直接 `nativeFetch(...)`，**没有 `signal`**。
只有流式 `openChatStream` 有 `setTimeout(() => controller.abort(), 300000)`（`llm.ts:239-240`）。
回测工具链每一轮都先发一次非流式 `chatCompletion`（选工具），一旦 provider 挂起：
- `withRetry` 不触发（没有抛错），时间不限；
- 输入框被 `:disabled="chatStore.isStreaming"` 锁死，无停止按钮 → 只能刷新。
这与「卡住不动」型的中断一致。

### R3 — 工具轮次上限耗尽只给一个 5 秒后消失的泛化提示
`toolLoop.ts:MAX_TOOL_ITERATIONS = 8`；`index.ts:297-302` 在 `!endedWithError && !streamedAnyContent`
时只发 `status: 'AI 未能完成回答（未获取到有效数据），请重试或更换模型'`，而 `chatStore.onStatus`
5 秒后自动清掉 banner。回测场景模型常连续多轮调用工具（list → run → run…），到顶后
**没有最终回答也没有明确原因** → 又像是「中断」。

### R4 — 错误路径重复 finalize / 重复落库
`frontend/src/services/chatApi.ts:65-68` 的 catch 同时调 `onError(...)` **和** `onDone()`；
引擎在 `error` 事件之后也**总会** `yield done`（`index.ts:304`）。而 `chatStore.onError`
（`chatStore.ts:282-301`）已经 `finalizeStream()` + 落库 + autoTitle，`onDone`（`:259-281`）
随后又找 `role === 'assistant'` 的消息再落一次 → **同一条错误在 Dexie 里写两遍**，且会覆盖
真实状态。现有测试 `chatStore.test.ts` 的 `savedAssistantMessage()` 恰好断言「只有 1 条 assistant」，
是现成的回归护栏。

### R5 — `trimMessages` 会拆散 `tool_calls` / `tool` 配对
`frontend/src/services/chatEngine/toolLoop.ts:69-73`
```ts
export function trimMessages(messages: LLMMessage[], maxTokens: number): void {
  while (estimateMessagesTokens(messages) > maxTokens && messages.length > 1) {
    const skip = messages.length > 0 && messages[0]?.role === 'system' ? 1 : 0
    if (messages.length <= skip + 1) break
    messages.splice(skip, 1)   // ← 逐条删，可能只删掉 assistant(tool_calls) 或只删掉 tool
  }
}
```
`MAX_CONTEXT_TOKENS = 50000`（约 150k 字符）。回测多轮工具（单轮最多 8 个工具、结果各截断到
4000 字符）叠加长会话时可能触发裁剪；删掉 `assistant(tool_calls)` 而留下其后的 `role:'tool'`
消息（或反之）会让下一次请求被 provider 以 400 拒绝 → 整轮对话报错中断。

---

## 2. 需要改动的文件与具体改法

### 2.1 `frontend/src/services/chatEngine/index.ts`（核心）
新增 `import { clientLogger } from '../../core/logger'`。

**(a) R1 修复** —— `:260` 的 catch 改为：
```ts
} catch (error) {
  if (fullContent) {
    clientLogger.warn('chat.stream.interrupted', {
      iter,
      chars: fullContent.length,
      error: String(error),
      model: config.model,
      apiBase: config.apiBase,
    })
    yield {
      event: 'status',
      data: JSON.stringify({
        message: `回答在传输中断（${String(error)}），已保留已生成内容`,
        level: 'warn',
      }),
    }
    yield { event: 'token', data: JSON.stringify({ token: '', full: fullContent }) }
    break
  }
  clientLogger.warn('chat.stream.failed', { iter, error: String(error) })
  // …原 fallback 分支（非流式 chatCompletion）保持不变
```

**(b) R2/可观测性埋点**（`clientLogger.info`，context 只放元数据，**绝不放 apiKey、不放完整 prompt**）：
- 轮次开始：`chat.turn.start { skill, model, historyCount }`；
- 每次非流式调用：`chat.llm.call { iter, durationMs, contentChars, nativeCalls, xmlCalls, usage }`；
- 每次工具：`chat.tool.end { name, durationMs, ok, empty }`（`ok===false` 用 `warn`）；
- 流式：`chat.stream.start { iter }` / `chat.stream.end { chars, usage }`；
- 收尾兜底：见 (c)。

**(c) R3 修复** —— 在 `for` 循环后用「是否发生过工具轮」区分提示：
```ts
if (!endedWithError && !streamedAnyContent) {
  const exhausted = toolRounds > 0
  if (exhausted) {
    clientLogger.warn('chat.loop.exhausted', { iterations: MAX_TOOL_ITERATIONS, toolRounds })
  }
  yield {
    event: 'status',
    data: JSON.stringify({
      message: exhausted
        ? `已达到工具调用轮次上限（${MAX_TOOL_ITERATIONS} 轮）仍未收尾，可缩小问题范围或重试`
        : 'AI 未能完成回答（未获取到有效数据），请重试或更换模型',
      level: exhausted ? 'warn' : 'info',
    }),
  }
}
```
（新增局部计数 `let toolRounds = 0`，`calls.length > 0` 分支里 `toolRounds++`。）

### 2.2 `frontend/src/services/llm.ts`（超时）
- `ChatCompletionOptions` 增加 `timeoutMs?: number`；新增
  `const DEFAULT_REQUEST_TIMEOUT_MS = 120_000`、`const DEFAULT_STREAM_TIMEOUT_MS = 300_000`。
- `requestChat()` 改为：建立 `AbortController` + `setTimeout`，把 `signal` 塞进 `init` 传给
  `nativeFetch`，`finally` 中 `clearTimeout`；`controller.signal.aborted` 为真时抛
  `new Error(\`LLM request timeout after ${timeoutMs}ms\`)`（英文含 `timeout`，可被 `withRetry` 识别为可重试）。
  这样 `chatCompletion` / `chatCompletionJson`（分析场景也会用到）都获得有界等待。
- `openChatStream()` 的硬编码 `300000` 改为 `options.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS`，
  abort 时 `clientLogger.warn('llm.stream_timeout', { timeoutMs })`。
- 非 2xx 分支补 `clientLogger.error('llm.http_error', { status, message })`（`message` 是 provider 文本，
  不含 key）。

### 2.3 `frontend/src/services/chatEngine/toolLoop.ts`
- `isRetryableLLMError` 的两处副本（`llm.ts` 与 `toolLoop.ts`）正则都补 `abort`/`超时`：
  `/timeout|abort|econn|…|超时/`。
- `trimMessages` 改成**按组原子删除**，保证 `role:'assistant'` 的 `tool_calls` 与其后紧邻的
  `role:'tool'` 同生共死：
```ts
export function trimMessages(messages: LLMMessage[], maxTokens: number): void {
  const skip = messages[0]?.role === 'system' ? 1 : 0
  while (estimateMessagesTokens(messages) > maxTokens && messages.length > skip + 1) {
    const first = messages[skip]
    let drop = 1
    if (first?.role === 'assistant' && first.tool_calls?.length) {
      while (messages[skip + drop]?.role === 'tool') drop += 1
    }
    if (messages.length - drop <= skip) break
    messages.splice(skip, drop)
  }
}
```

### 2.4 `frontend/src/services/chatApi.ts`
- `ChatCallbacks.onStatus: (message: string, level?: 'info' | 'warn') => void`；
- `_handleEvent` 的 `case 'status'` 透传 `parsed.level === 'warn' ? 'warn' : 'info'`；
- catch 里保留 `onError` + `onDone`（避免行为变化，由 store 侧幂等兜底），补
  `clientLogger.error('chat.api.failed', { error: String(err) })`。

### 2.5 `frontend/src/stores/chatStore.ts`
- state 增 `streamClosed: false` 与 `retryLevel: 'info' as 'info' | 'warn'`。
- `finalizeStream()` 开头 `if (this.streamClosed) return; this.streamClosed = true;`（其余逻辑不变）。
- `onDone` 开头 `if (this.streamClosed) return;` —— 一句话同时修掉 R4 的
  「onError 之后再 onDone 重复落库」以及 catch 里 onError+onDone 的重复。
- `sendMessage` 起始处 `this.streamClosed = false; this.retryLevel = 'info'`。
- `onStatus(message, level)`：`level === 'warn'` 时 `retryMessage = message`、`retryLevel = 'warn'`
  且**不设 5s 自动清除**（留到下一次 `sendMessage` 才清）；否则维持现状（spinner + 5s 清除）。
- `onError`：补 `clientLogger.error('chat.turn.error', { error })`。
- 可选（同文件、顺手）：`onUsage` 目前 `find(m => m.id === '__streaming__' || m.role === 'assistant')`
  会命中历史里第一条 assistant 并覆盖其 usage。改为把 usage 存进 state（`streamUsage`），
  `finalizeStream()` 时挂到新消息上、`displayMessages` 时挂到流式占位。若不改，仅记录在风险里。

### 2.6 `frontend/src/components/ChatPanel.vue`（最小可见性改动，非结构改动）
retry banner 目前固定渲染转圈 Loader。改为按级别选图标，避免把「已中断」误显示成「还在跑」：
```html
<LucideIcon
  :name="chatStore.retryLevel === 'warn' ? 'TriangleAlert' : 'Loader'"
  :size="12"
  :class="{ spinning: chatStore.retryLevel !== 'warn' }"
/>
```

### 2.7 测试
- `frontend/src/__tests__/services/chatEngine.test.ts`
  - 顶部加 `vi.mock('../../core/logger', () => ({ clientLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))`，
    断言 `clientLogger.warn` 带 `chat.stream.interrupted`；同时避免真实 logger 的 5s flush 定时器影响测试。
  - 新用例 A：`openChatStream` 先吐 2 个 token 再 `throw` → 断言事件序列里出现
    `{ event:'status', data:{ level:'warn' } }`，且最后一个 `token.full` 保留半截正文，之后是 `done`。
  - 新用例 B：`chatCompletion` 连续 8 次都返回 tool_call → 断言收尾 `status` 文案含「轮次上限」。
- `frontend/src/__tests__/services/toolLoop.test.ts`（新建）：构造 system + user + assistant(tool_calls)
  + 2×tool 的消息，令 `maxTokens` 触发裁剪，断言：system 保留；不存在「`tool` 消息出现在其
  `tool_calls` assistant 之前」或「assistant(tool_calls) 被删而其 tool 还在」。
- `frontend/src/__tests__/services/llm.test.ts`：`vi.useFakeTimers()` + `nativeFetch` 返回永不 resolve 的
  Promise → 断言 `chatCompletion` 因 `timeout` 而 reject。
- `frontend/src/__tests__/stores/chatStore.test.ts`：新用例——mock 的 `sendMessage` 先 `onError('boom')`
  再 `await onDone()` → 断言只落库 1 条 assistant 错误消息（复用 `savedAssistantMessage()`）。

### 2.8 文档
- `docs/architecture/ai-chat.md`：新增「健壮性与可观测性」小节，记录
  - `status` 事件新增可选 `level`（`info` 瞬态 / `warn` 常驻）；
  - 三类已修复的中断（流断流、非流式超时、轮次耗尽）触发的事件名与文案；
  - 前端日志事件命名（`chat.*` / `llm.*`）与查看路径（LogsViewer → source `Frontend`）。

---

## 3. 实施步骤（每步独立可验证）

1. **`chatEngine/index.ts`**：加 logger 导入 + R1/R3 修复 + 埋点。(先做这步，其余依赖它的事件契约)
2. **`llm.ts`**：`timeoutMs` + `requestChat` 超时 + 流超时日志 + `isRetryableLLMError` 补 abort。(此时 R2 闭环)
3. **`toolLoop.ts`**：`trimMessages` 按组删除 + 正则同步。(R5)
4. **`chatApi.ts`**：`onStatus` level 透传 + catch 日志。
5. **`chatStore.ts`**：`streamClosed` 幂等守卫 + `retryLevel` + 日志。(R4)
6. **`ChatPanel.vue`**：warn 图标。
7. **测试**：2.7 四处；跑 `cd frontend && bunx vue-tsc --noEmit && bun run test`。
8. **文档**：`docs/architecture/ai-chat.md`；跑 `cd docs && bun run build`。
9. **本地校验全量**：`cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build`。

---

## 4. 风险 / 未决点

- **隐私**：日志会写本地磁盘（`python/Data/logs/frontend-*.jsonl`）。埋点只写元数据
  （skill/model/耗时/字符数/错误串/工具名），**不写 `apiKey`、Authorization、完整 prompt**；
  若需要正文摘要，统一截断到 ~200 字符。
- **`abort` 进可重试正则**：本次没有用户取消，abort 只来自超时，因此把它判为可重试是安全的；
  将来若加「停止」按钮，需给用户取消单独的错误类型/消息，避免被 `withRetry` 重试。
- **超时默认值**：非流式 120s 是我按 provider 常态取的保守值；若你常用慢模型（长 CoT / 大
  上下文），可能需要在设置里暴露成可配置项（本次未加设置 UI）。
- **`switchSession` 期间的在飞流**：本次不取消，仅靠 `streamClosed` 让迟到的 `onDone` 不再写入
  新会话；在飞流仍会在后台跑完（但结果不落库）。彻底解决属于「可中断」选项。
- ~~prod/Electron 静态托管的日志上报~~：**已作废（2026-10-07）**——本项目没有 prod，开发与使用均为 dev。
  已移除 `VITE_FALLBACK_API_BASE` / `api.ts` 的 `localhost:8310` 回退与 `vite preview`；日志上报只在
  dev（Vite 代理 `/api` → 8310）下使用，已用真浏览器验证可用。
- **测试定时器**：真实 `clientLogger` 的 `setTimeout(…, 5000)` 在 vitest 里可能留下 pending timer；
  因此 2.7 要求 mock 掉 `core/logger`。若新测试遗漏 mock，可能表现为测试进程退出变慢。
- 我未改动 service 侧任何代码——`/api/logs/ingest` 与 frontend 源已就绪。
