<template>
  <div class="chat-panel" :class="{ 'chat-panel--wide': chatStore.isWideMode }" @click.stop>
    <!-- Header -->
    <div class="chat-header">
      <div class="chat-header-left">
        <button class="chat-header-btn" @click="chatStore.toggleWideMode()" :title="chatStore.isWideMode ? '窄屏模式' : '宽屏模式'">
          <LucideIcon :name="chatStore.isWideMode ? 'PanelRightClose' : 'PanelRightOpen'" :size="16" />
        </button>
        <LucideIcon name="Bot" :size="18" />
        <span class="chat-title">AI 助手</span>
      </div>
      <div class="chat-header-actions">
        <button class="chat-header-btn" @click="handleNewSession" title="新对话">
          <LucideIcon name="Plus" :size="16" />
        </button>
        <button class="chat-header-btn" @click="$emit('close')" title="最小化">
          <LucideIcon name="Minimize2" :size="16" />
        </button>
      </div>
    </div>

    <!-- Session list (collapsible in narrow, always visible in wide) -->
    <div v-if="showSessions || chatStore.isWideMode" class="chat-sessions">
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

    <!-- Chat main area (messages + input) -->
    <div class="chat-main">
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
          v-if="!chatStore.isWideMode"
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

<style src="./ChatPanel.css" scoped></style>
