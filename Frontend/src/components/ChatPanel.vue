<template>
  <div class="chat-panel" @click.stop>
    <!-- Header -->
    <div class="chat-header">
      <div class="chat-header-left">
        <LucideIcon name="Bot" :size="18" />
        <span class="chat-title">AI 助手</span>
      </div>
      <div class="chat-header-actions">
        <button class="chat-header-btn" @click="handleNewSession" title="新对话">
          <LucideIcon name="Plus" :size="16" />
        </button>
        <button class="chat-header-btn" @click="$emit('close')" title="关闭">
          <LucideIcon name="X" :size="16" />
        </button>
      </div>
    </div>

    <!-- Session list (collapsible) -->
    <div v-if="showSessions" class="chat-sessions">
      <div class="session-list">
        <button
          v-for="session in chatStore.sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === chatStore.currentSessionId }"
          @click="handleSwitchSession(session.id)"
        >
          <LucideIcon name="MessageSquare" :size="14" />
          <span class="session-title">{{ session.title }}</span>
          <span
            class="session-delete"
            role="button"
            tabindex="0"
            @click.stop="chatStore.deleteSession(session.id)"
            @keydown.enter.stop="chatStore.deleteSession(session.id)"
            title="删除"
          >
            <LucideIcon name="Trash2" :size="12" />
          </span>
        </button>
      </div>
    </div>

    <!-- Messages -->
    <div class="chat-messages" ref="messagesRef">
      <div v-if="chatStore.messages.length === 0 && !chatStore.isStreaming" class="chat-welcome">
        <LucideIcon name="Bot" :size="40" />
        <h3>您好！我是 GoFundBot 助手</h3>
        <p>我可以帮您查询基金数据、市场行情、运行回测分析等。</p>
        <div class="welcome-suggestions">
          <button
            v-for="(s, i) in suggestions"
            :key="i"
            class="suggestion-btn"
            @click="sendSuggestion(s.text)"
          >
            {{ s.text }}
          </button>
        </div>
      </div>

      <div
        v-for="msg in chatStore.displayMessages"
        :key="msg.id"
        class="message-row"
        :class="msg.role"
      >
        <div class="message-avatar">
          <LucideIcon :name="msg.role === 'user' ? 'User' : 'Bot'" :size="16" />
        </div>
        <div class="message-content">
          <!-- Tool calls visualization -->
          <div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="tool-calls">
            <div
              v-for="(tc, idx) in msg.toolCalls"
              :key="idx"
              class="tool-call-item"
              :class="tc.status"
            >
              <LucideIcon
                :name="tc.status === 'running' ? 'Loader' : 'CheckCircle'"
                :size="14"
                :class="{ spinning: tc.status === 'running' }"
              />
              <span class="tool-call-name">{{ toolLabels[tc.name] || tc.name }}</span>
              <span v-if="tc.status === 'done' && tc.durationMs" class="tool-call-duration">
                {{ (tc.durationMs / 1000).toFixed(1) }}s
              </span>
            </div>
          </div>

          <!-- Markdown content -->
          <div v-if="msg.content" class="message-text" v-html="renderMarkdown(msg.content)" />
          <!-- Thinking indicator (streaming placeholder, no tokens yet, no running tools) -->
          <div v-if="msg.id === '__streaming__' && !msg.content && chatStore.isStreaming && !hasRunningToolCall" class="thinking-indicator">
            <span class="thinking-text">正在思考</span>
            <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
          </div>
        </div>
      </div>

      <div ref="scrollAnchor" />
    </div>

    <!-- Input -->
    <div class="chat-input-area">
      <button
        class="chat-session-toggle"
        @click="showSessions = !showSessions"
        :title="showSessions ? '隐藏会话' : '显示会话'"
      >
        <LucideIcon :name="showSessions ? 'PanelLeftClose' : 'PanelLeft'" :size="16" />
      </button>
      <textarea
        v-model="inputMessage"
        class="chat-input"
        placeholder="输入问题..."
        :disabled="chatStore.isStreaming"
        @keydown.enter.exact.prevent="handleSend"
        rows="1"
        ref="inputRef"
      />
      <button
        class="chat-send-btn"
        :disabled="chatStore.isStreaming || !inputMessage.trim()"
        @click="handleSend"
      >
        <LucideIcon name="Send" :size="16" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { marked } from 'marked'
import { useChatStore } from '../stores/chatStore'
import LucideIcon from './LucideIcon.vue'

defineEmits<{ close: [] }>()

const chatStore = useChatStore()
const inputMessage = ref('')
const messagesRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const scrollAnchor = ref<HTMLElement | null>(null)
const showSessions = ref(false)
const hasRunningToolCall = computed(() =>
  chatStore.activeToolCalls.some(t => t.status === 'running')
)

const toolLabels: Record<string, string> = {
  search_funds: '搜索基金',
  get_fund_detail: '获取基金详情',
  get_fund_estimate: '获取基金估值',
  get_fund_nav_history: '获取净值历史',
  get_market_indices: '获取指数行情',
  get_market_news: '获取市场快讯',
  get_hot_sectors: '获取热门板块',
  get_north_flow: '获取北向资金',
  get_market_breadth: '获取涨跌统计',
  get_main_flow: '获取主力资金',
  get_flash_news: '获取快讯新闻',
  get_watchlist: '获取自选列表',
  screen_funds_by_4433: '4433筛选基金',
  run_backtest: '运行定投回测',
  suggest_strategy: '推荐定投策略',
  get_stock_quote: '获取个股行情',
  get_market_anomaly: '检查市场异动',
  get_gold_realtime: '获取黄金价格',
  get_fund_holdings: '获取基金持仓',
  get_fund_managers: '获取基金经理',
}

const suggestions = [
  { text: '今天大盘怎么样？' },
  { text: '帮我看看北向资金流向' },
  { text: '筛选通过4433法则的基金' },
  { text: '推荐几只值得关注的基金' },
]

onMounted(() => {
  chatStore.init()
  inputRef.value?.focus()
})

watch(
  () => chatStore.displayMessages.length,
  () => {
    nextTick(() => {
      scrollAnchor.value?.scrollIntoView({ behavior: 'smooth' })
    })
  }
)

watch(
  () => chatStore.streamingContent,
  () => {
    nextTick(() => {
      scrollAnchor.value?.scrollIntoView({ behavior: 'smooth' })
    })
  }
)

async function handleSend() {
  const text = inputMessage.value.trim()
  if (!text || chatStore.isStreaming) return
  inputMessage.value = ''
  await chatStore.sendMessage(text)
  nextTick(() => {
    inputRef.value?.focus()
  })
}

function sendSuggestion(text: string) {
  inputMessage.value = text
  handleSend()
}

async function handleNewSession() {
  await chatStore.createSession()
  inputRef.value?.focus()
}

async function handleSwitchSession(id: number) {
  await chatStore.switchSession(id)
  showSessions.value = false
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text, { breaks: true }) as string
}
</script>

<style scoped>
.chat-panel {
  position: fixed;
  bottom: 88px;
  right: 24px;
  width: 420px;
  height: 620px;
  max-height: calc(100vh - 120px);
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Header ── */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--color-primary);
  color: white;
  flex-shrink: 0;
}

.chat-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.chat-header-actions {
  display: flex;
  gap: 4px;
}

.chat-header-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.chat-header-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* ── Session list ── */
.chat-sessions {
  max-height: 160px;
  overflow-y: auto;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-subtle);
  flex-shrink: 0;
}

.session-list {
  padding: 4px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  transition: background 0.15s;
}

.session-item:hover {
  background: var(--bg-hover);
}

.session-item.active {
  background: var(--color-primary-bg);
  color: var(--color-primary);
}

.session-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-delete {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s;
}

.session-item:hover .session-delete {
  opacity: 1;
}

.session-delete:hover {
  color: var(--color-danger);
  background: var(--color-danger-bg);
}

/* ── Messages ── */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-welcome {
  text-align: center;
  padding: 24px 16px;
  color: var(--text-secondary);
}

.chat-welcome h3 {
  margin: 12px 0 8px;
  font-size: 16px;
  color: var(--text-primary);
}

.chat-welcome p {
  font-size: 13px;
  margin-bottom: 16px;
}

.welcome-suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 280px;
  margin: 0 auto;
}

.suggestion-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.15s;
}

.suggestion-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.message-row {
  display: flex;
  gap: 8px;
  max-width: 90%;
}

.message-row.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.message-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.message-row.user .message-avatar {
  background: var(--color-primary);
  color: white;
}

.message-content {
  min-width: 0;
}

.message-text {
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.message-row.assistant .message-text {
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
}

.message-row.user .message-text {
  background: var(--color-primary);
  color: white;
}

/* ── Tool calls ── */
.tool-calls {
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-call-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--bg-subtle);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.tool-call-item.done {
  color: var(--color-success);
}

.tool-call-name {
  flex: 1;
}

.tool-call-duration {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* ── Input ── */
.chat-input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-card);
  flex-shrink: 0;
}

.chat-session-toggle {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-default);
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition: all 0.15s;
}

.chat-session-toggle:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.chat-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  resize: none;
  outline: none;
  min-height: 36px;
  max-height: 120px;
  line-height: 1.4;
}

.chat-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-bg);
}

.chat-input::placeholder {
  color: var(--text-tertiary);
}

.chat-send-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.chat-send-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.chat-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Markdown styling ── */
:deep(.message-text h2),
:deep(.message-text h3),
:deep(.message-text h4) {
  margin: 8px 0 4px;
  color: var(--text-primary);
}

:deep(.message-text h2) { font-size: 15px; }
:deep(.message-text h3) { font-size: 14px; }
:deep(.message-text h4) { font-size: 13px; }

:deep(.message-text p) { margin: 4px 0; }

:deep(.message-text ul),
:deep(.message-text ol) {
  margin: 4px 0;
  padding-left: 20px;
}

:deep(.message-text li) {
  margin: 2px 0;
}

:deep(.message-text code) {
  background: var(--bg-elevated);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'SFMono-Regular', Consolas, monospace;
}

:deep(.message-text pre) {
  margin: 8px 0;
  padding: 8px 12px;
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  overflow-x: auto;
}

:deep(.message-text pre code) {
  background: none;
  padding: 0;
  font-size: 12px;
}

:deep(.message-text strong) {
  font-weight: 600;
}

/* ── Thinking indicator ── */
.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-secondary);
}

.thinking-dots span {
  animation: blink 1.4s infinite;
  font-size: 18px;
  line-height: 1;
  font-weight: 700;
  color: var(--color-primary);
}

.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}

/* ── Animations ── */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .chat-panel {
    bottom: 0;
    right: 0;
    width: 100%;
    height: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .chat-messages {
    padding-bottom: 8px;
  }

  .message-row {
    max-width: 85%;
  }
}
</style>
