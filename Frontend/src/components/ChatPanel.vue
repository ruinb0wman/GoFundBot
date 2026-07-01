<template>
  <div class="chat-panel" :class="{ 'chat-panel--wide': chatStore.isWideMode }" @click.stop>
    <!-- Header -->
    <div class="chat-header">
      <div class="chat-header-left">
        <button class="chat-header-btn" @click="chatStore.toggleWideMode()" :title="chatStore.isWideMode ? t('chat.narrowMode') : t('chat.wideMode')">
          <LucideIcon :name="chatStore.isWideMode ? 'PanelRightClose' : 'PanelRightOpen'" :size="16" />
        </button>
        <LucideIcon name="Bot" :size="18" />
        <span class="chat-title">{{ t('chat.title') }}</span>
      </div>
      <div class="chat-header-actions">
        <button class="chat-header-btn" @click="handleNewSession" :title="t('chat.newSession')">
          <LucideIcon name="Plus" :size="16" />
        </button>
        <button class="chat-header-btn" @click="$emit('close')" :title="t('chat.minimize')">
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
            :title="t('chat.delete')"
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
        <h3>{{ t('chat.welcomeTitle') }}</h3>
        <p>{{ t('chat.welcomeDesc') }}</p>
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
            <span class="thinking-text">{{ t('chat.thinking') }}</span>
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
          :title="showSessions ? t('chat.hideSessions') : t('chat.showSessions')"
        >
          <LucideIcon :name="showSessions ? 'PanelLeftClose' : 'PanelLeft'" :size="16" />
        </button>
        <textarea
          v-model="inputMessage"
          class="chat-input"
          :placeholder="t('chat.inputPlaceholder')"
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
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import { useChatStore } from '../stores/chatStore'
import LucideIcon from './LucideIcon.vue'

const { t } = useI18n()

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

const toolLabels = computed((): Record<string, string> => ({
  search_funds: t('chat.tool.searchFunds'),
  get_fund_detail: t('chat.tool.getFundDetail'),
  get_fund_estimate: t('chat.tool.getFundEstimate'),
  get_fund_nav_history: t('chat.tool.getFundNavHistory'),
  get_market_indices: t('chat.tool.getMarketIndices'),
  get_market_news: t('chat.tool.getMarketNews'),
  get_hot_sectors: t('chat.tool.getHotSectors'),
  get_north_flow: t('chat.tool.getNorthFlow'),
  get_market_breadth: t('chat.tool.getMarketBreadth'),
  get_main_flow: t('chat.tool.getMainFlow'),
  get_flash_news: t('chat.tool.getFlashNews'),
  get_watchlist: t('chat.tool.getWatchlist'),
  screen_funds_by_4433: t('chat.tool.screenFundsBy4433'),
  run_backtest: t('chat.tool.runBacktest'),
  suggest_strategy: t('chat.tool.suggestStrategy'),
  get_stock_quote: t('chat.tool.getStockQuote'),
  get_market_anomaly: t('chat.tool.getMarketAnomaly'),
  get_gold_realtime: t('chat.tool.getGoldRealtime'),
  get_fund_holdings: t('chat.tool.getFundHoldings'),
  get_fund_managers: t('chat.tool.getFundManagers'),
}))

const suggestions = computed(() => [
  { text: t('chat.suggestion1') },
  { text: t('chat.suggestion2') },
  { text: t('chat.suggestion3') },
  { text: t('chat.suggestion4') },
])

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
