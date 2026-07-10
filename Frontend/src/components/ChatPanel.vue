<template>
  <div class="chat-panel" :class="{ 'chat-panel--wide': chatStore.isWideMode }" @click.stop>
    <!-- Header -->
    <div class="chat-header">
      <div class="chat-header-left">
        <BButton circle size="small" :icon="chatStore.isWideMode ? 'PanelRightClose' : 'PanelRightOpen'" @click="chatStore.toggleWideMode()" :title="chatStore.isWideMode ? t('chat.narrowMode') : t('chat.wideMode')" />
        <LucideIcon name="Bot" :size="18" />
        <span class="chat-title">{{ t('chat.title') }}</span>
      </div>
      <div class="chat-header-actions">
        <BButton circle size="small" icon="Plus" @click="handleNewSession" :title="t('chat.newSession')" />
        <BButton circle size="small" icon="Minimize2" @click="$emit('close')" :title="t('chat.minimize')" />
      </div>
    </div>

    <!-- Session list (collapsible in narrow, always visible in wide) -->
    <div v-if="showSessions || chatStore.isWideMode" class="chat-sessions">
      <div class="session-list">
        <div
          v-for="session in chatStore.sessions"
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === chatStore.currentSessionId }"
          @click="handleSwitchSession(session.id)"
        >
          <div class="session-item-title">
            <LucideIcon name="MessageSquare" :size="14" />
            <span class="session-title">{{ session.title }}</span>
          </div>
          <div class="session-item-meta">
            <span class="session-time">{{ formatTime(session.updated_at) }}</span>
            <span
              class="session-delete"
              role="button"
              tabindex="0"
              @click.stop="handleDeleteClick(session)"
              @keydown.enter.stop="handleDeleteClick(session)"
              :title="t('chat.delete')"
            >
              <LucideIcon name="Trash2" :size="12" />
            </span>
          </div>
        </div>
      </div>
    </div>
    <BDialog
      :visible="deleteTarget !== null"
      :title="t('chat.deleteConfirmTitle')"
      :message="t('chat.deleteConfirmMessage')"
      danger
      :confirmText="t('chat.delete')"
      :cancelText="t('chat.cancel')"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />

    <!-- Chat main area (messages + input) -->
    <div class="chat-main">
      <!-- Messages -->
      <div class="chat-messages" ref="messagesRef">
      <div v-if="chatStore.messages.length === 0 && !chatStore.isStreaming" class="chat-welcome">
        <LucideIcon name="Bot" :size="40" />
        <h3>{{ t('chat.welcomeTitle') }}</h3>
        <p>{{ t('chat.welcomeDesc') }}</p>
        <div class="welcome-suggestions">
          <BButton
            v-for="(s, i) in suggestions"
            :key="i"
            plain
            @click="sendSuggestion(s.text)"
          >
            {{ s.text }}
          </BButton>
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
          <!-- Per-message token usage -->
          <div v-if="msg.usage" class="message-usage">
            ↑ {{ formatTokens(msg.usage.inputTokens) }} · ↓ {{ formatTokens(msg.usage.outputTokens) }}
          </div>
          <!-- Thinking indicator (streaming placeholder, no tokens yet, no running tools) -->
          <div v-if="msg.id === '__streaming__' && !msg.content && chatStore.isStreaming && !hasRunningToolCall" class="thinking-indicator">
            <span class="thinking-text">{{ t('chat.thinking') }}</span>
            <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
          </div>
        </div>
      </div>

        <div ref="scrollAnchor" />
      </div>

      <!-- Retry banner -->
      <div v-if="chatStore.retryMessage" class="retry-banner">
        <LucideIcon name="Loader" :size="12" class="spinning" />
        <span>{{ chatStore.retryMessage }}</span>
      </div>

      <!-- Skill bar -->
      <div class="chat-skill-bar" v-if="!chatStore.isStreaming" @click.stop>
        <span class="skill-label">{{ t('chat.skillLabel') }}</span>
        <div class="skill-dropdown-wrapper" @click="showSkillPicker = !showSkillPicker">
          <span class="skill-current" :class="{ 'skill-auto': !chatStore.currentSkill }">
            {{ currentSkillLabel }}
          </span>
          <LucideIcon name="ChevronDown" :size="12" />
          <div v-if="showSkillPicker" class="skill-dropdown-menu">
            <div
              v-for="opt in chatStore.skillOptions"
              :key="opt.name"
              class="skill-dropdown-item"
              :class="{ active: (chatStore.selectedSkill || null) === opt.name || (!chatStore.selectedSkill && opt.name === 'auto') }"
              @click.stop="selectSkill(opt.name)"
            >
              {{ opt.label }}
            </div>
          </div>
        </div>
        <span v-if="chatStore.sessionTotalTokens > 0" class="session-tokens">
          {{ formatTokens(chatStore.sessionTotalTokens) }}
        </span>
      </div>

      <!-- Skill badge during streaming -->
      <div class="chat-skill-bar chat-skill-bar--streaming" v-else-if="chatStore.currentSkill">
        <span class="skill-label">{{ t('chat.skillLabel') }}</span>
        <span class="skill-current">{{ currentSkillLabel }}</span>
        <span class="skill-badge-dot" />
        <span v-if="chatStore.sessionTotalTokens > 0" class="session-tokens">
          {{ formatTokens(chatStore.sessionTotalTokens) }}
        </span>
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
        <BButton type="primary" circle icon="Send" @click="handleSend" :disabled="chatStore.isStreaming || !inputMessage.trim()" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { marked } from 'marked'
import { useChatStore } from '../stores/chatStore'
import BButton from './BButton.vue'
import BDialog from './BDialog.vue'
import LucideIcon from './LucideIcon.vue'

const { t } = useI18n()

defineEmits<{ close: [] }>()

const chatStore = useChatStore()
const inputMessage = ref('')
const messagesRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const scrollAnchor = ref<HTMLElement | null>(null)
const showSessions = ref(false)
const showSkillPicker = ref(false)
const deleteTarget = ref<{ id: number; title: string } | null>(null)
const hasRunningToolCall = computed(() =>
  chatStore.activeToolCalls.some(t => t.status === 'running')
)

const currentSkillLabel = computed(() => {
  if (!chatStore.currentSkill) return t('chat.skillAuto')
  const opt = chatStore.skillOptions.find(s => s.name === chatStore.currentSkill)
  return opt ? opt.label : t('chat.skillAuto')
})

const skillSuggestions = computed(() => {
  const skill = chatStore.currentSkill
  if (skill === 'market_overview') return [
    { text: t('chat.suggMarket1') },
    { text: t('chat.suggMarket2') },
    { text: t('chat.suggMarket3') },
  ]
  if (skill === 'fund_analysis') return [
    { text: t('chat.suggFund1') },
    { text: t('chat.suggFund2') },
    { text: t('chat.suggFund3') },
  ]
  if (skill === 'fund_screening') return [
    { text: t('chat.suggScreen1') },
    { text: t('chat.suggScreen2') },
    { text: t('chat.suggScreen3') },
  ]
  if (skill === 'news_briefing') return [
    { text: t('chat.suggNews1') },
    { text: t('chat.suggNews2') },
    { text: t('chat.suggNews3') },
  ]
  if (skill === 'investment_strategy') return [
    { text: t('chat.suggStrategy1') },
    { text: t('chat.suggStrategy2') },
    { text: t('chat.suggStrategy3') },
  ]
  return [
    { text: t('chat.suggestion1') },
    { text: t('chat.suggestion2') },
    { text: t('chat.suggestion3') },
    { text: t('chat.suggestion4') },
  ]
})

const toolLabels = computed((): Record<string, string> => ({
  search_funds: t('chat.tool.searchFunds'),
  get_fund_detail: t('chat.tool.getFundDetail'),
  get_fund_estimate: t('chat.tool.getFundEstimate'),
  get_fund_nav_history: t('chat.tool.getFundNavHistory'),
  get_market_indices: t('chat.tool.getMarketIndices'),
  get_market_news: t('chat.tool.getMarketNews'),
  get_hot_sectors: t('chat.tool.getHotSectors'),
  get_concept_sectors: t('chat.tool.getConceptSectors'),
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
  get_funds_by_industry: t('chat.tool.getFundsByIndustry'),
  get_industry_performance: t('chat.tool.getIndustryPerformance'),
}))

const suggestions = computed(() => skillSuggestions.value)

function onClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.chat-skill-bar')) {
    showSkillPicker.value = false
  }
}

onMounted(() => {
  chatStore.init()
  inputRef.value?.focus()
  document.addEventListener('click', onClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
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

function selectSkill(name: string) {
  showSkillPicker.value = false
  if (name === 'auto') {
    chatStore.selectSkill(null)
  } else {
    chatStore.selectSkill(name)
  }
}

function handleDeleteClick(session: { id: number; title: string }) {
  deleteTarget.value = session
}

async function confirmDelete() {
  if (deleteTarget.value) {
    await chatStore.deleteSession(deleteTarget.value.id)
  }
  deleteTarget.value = null
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text, { breaks: true }) as string
}
</script>

<style src="./ChatPanel.css" scoped></style>
