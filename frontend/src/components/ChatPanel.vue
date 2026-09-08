<template>
  <div class="chat-panel" :class="{ 'chat-panel--wide': chatStore.isWideMode, 'chat-panel--embedded': embedded }" @click.stop>
    <!-- Header -->
    <div class="chat-header">
      <div class="chat-header-left">
        <BButton v-if="!embedded" circle size="small" :icon="chatStore.isWideMode ? 'PanelRightClose' : 'PanelRightOpen'" @click="chatStore.toggleWideMode()" :title="chatStore.isWideMode ? '窄屏模式' : '宽屏模式'" />
        <LucideIcon name="Bot" :size="18" />
        <span class="chat-title">{{ panelTitle }}</span>
      </div>
      <div class="chat-header-actions">
        <BButton circle size="small" icon="Plus" @click="handleNewSession" :title="'新对话'" />
        <BButton v-if="!embedded" circle size="small" icon="Minimize2" @click="$emit('close')" :title="'最小化'" />
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
              :title="'删除'"
            >
              <LucideIcon name="Trash2" :size="12" />
            </span>
          </div>
        </div>
      </div>
    </div>
    <BDialog
      :visible="deleteTarget !== null"
      :title="'删除对话'"
      :subtitle="'确定删除该对话？删除后无法恢复。'"
      :options="[
        { icon: 'Trash2', title: '删除', value: 'confirm', danger: true },
        { icon: 'X', title: '取消', value: 'cancel' },
      ]"
      @select="handleDeleteDialogSelect"
      @cancel="deleteTarget = null"
    />

    <!-- Chat main area (messages + input) -->
    <div class="chat-main">
      <!-- Messages -->
      <div class="chat-messages" ref="messagesRef">
      <div v-if="chatStore.messages.length === 0 && !chatStore.isStreaming" class="chat-welcome">
        <LucideIcon name="Bot" :size="40" />
        <h3>{{ isStrategyMode ? '您好！我是策略顾问' : '您好！我是 GoFundBot 助手' }}</h3>
        <p>{{ isStrategyMode ? '我可以帮您讨论、制定和完善投资策略，并参考您已保存的策略记忆。' : '我可以帮您查询基金数据、市场行情、运行回测分析等。' }}</p>
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
                :name="tc.status === 'running' ? 'Loader' : tc.status === 'error' ? 'XCircle' : 'CheckCircle'"
                :size="14"
                :class="{ spinning: tc.status === 'running' }"
              />
              <span class="tool-call-name">{{ toolLabel(tc.name) }}</span>
              <span v-if="tc.status === 'done' && tc.durationMs" class="tool-call-duration">
                {{ (tc.durationMs / 1000).toFixed(1) }}s
              </span>
            </div>
          </div>

          <!-- Markdown content -->
          <div v-if="msg.content" class="message-text" v-html="renderMarkdown(msg.content)" />
          <!-- Save as strategy (strategy channel only) -->
          <div v-if="isStrategyMode && msg.role === 'assistant' && msg.content && msg.id !== '__streaming__'" class="message-save-actions">
            <button class="save-strategy-btn" @click="saveDraft(msg.content)">
              <LucideIcon name="BookmarkPlus" :size="13" /> {{ '保存为策略' }}
            </button>
          </div>
          <!-- Per-message token usage -->
          <div v-if="msg.usage" class="message-usage">
            ↑ {{ formatTokens(msg.usage.inputTokens) }} · ↓ {{ formatTokens(msg.usage.outputTokens) }}
          </div>
          <!-- Thinking indicator (streaming placeholder, no tokens yet, no running tools) -->
          <div v-if="msg.id === '__streaming__' && !msg.content && chatStore.isStreaming && !hasRunningToolCall" class="thinking-indicator">
            <span class="thinking-text">{{ '正在思考' }}</span>
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
        <span class="skill-label">{{ '技能' }}</span>
        <div v-if="!isStrategyMode" class="skill-dropdown-wrapper" @click="showSkillPicker = !showSkillPicker">
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
        <span v-else class="skill-current">策略</span>
        <span v-if="chatStore.sessionTotalTokens > 0" class="session-tokens">
          {{ formatTokens(chatStore.sessionTotalTokens) }}
        </span>
      </div>

      <!-- Skill badge during streaming -->
      <div class="chat-skill-bar chat-skill-bar--streaming" v-else-if="chatStore.currentSkill">
        <span class="skill-label">{{ '技能' }}</span>
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
          :title="showSessions ? '隐藏会话' : '显示会话'"
        >
          <LucideIcon :name="showSessions ? 'PanelLeftClose' : 'PanelLeft'" :size="16" />
        </button>
        <textarea
          v-model="inputMessage"
          class="chat-input"
          :placeholder="'输入问题...'"
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
import { BButton, BDialog, LucideIcon } from '@gofund/ui'
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { marked } from 'marked'
import { useChatStore } from '../stores/chatStore'
import { toolLabel as toolLabelFromRegistry } from '../services/chatEngine/toolContract'

const props = withDefaults(defineProps<{
  channel?: string
  forceSkill?: string
  embedded?: boolean
}>(), {
  channel: 'chat',
  forceSkill: undefined,
  embedded: false,
})

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

const emit = defineEmits<{ close: []; 'save-draft': [draft: { title: string; content: string }] }>()

const panelTitle = computed(() => props.forceSkill === 'strategy' ? '策略讨论' : 'AI 助手')

const isStrategyMode = computed(() => props.forceSkill === 'strategy')

const currentSkillLabel = computed(() => {
  if (!chatStore.currentSkill) return '自动'
  const opt = chatStore.skillOptions.find(s => s.name === chatStore.currentSkill)
  return opt ? opt.label : '自动'
})

const skillSuggestions = computed(() => {
  if (props.forceSkill === 'strategy') return [
    { text: '帮我完善我的投资策略' },
    { text: '帮我制定一个定投计划' },
    { text: '我的策略有什么漏洞？' },
    { text: '根据我的策略筛选合适的基金' },
  ]
  const skill = chatStore.currentSkill
  if (skill === 'market_overview') return [
    { text: '今天大盘怎么样？' },
    { text: '北向资金今日流向' },
    { text: '哪些板块在领涨' },
  ]
  if (skill === 'fund_analysis') return [
    { text: '分析基金 110022' },
    { text: '查一下基金持仓' },
    { text: '看看这只基金的业绩' },
  ]
  if (skill === 'fund_screening') return [
    { text: '筛选4433法则基金' },
    { text: '有哪些新能源基金' },
    { text: '哪个行业表现最好' },
  ]
  if (skill === 'news_briefing') return [
    { text: '今天有什么市场消息' },
    { text: '最近的重要新闻' },
    { text: '看看快讯' },
  ]
  if (skill === 'investment_strategy') return [
    { text: '基金 110022 定投回测' },
    { text: '推荐定投方案' },
    { text: '哪种定投策略更好' },
  ]
  return [
    { text: '今天大盘怎么样？' },
    { text: '帮我看看北向资金流向' },
    { text: '筛选通过4433法则的基金' },
    { text: '推荐几只值得关注的基金' },
  ]
})

const toolLabel = (name: string) => toolLabelFromRegistry(name)

const suggestions = computed(() => skillSuggestions.value)

function onClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.chat-skill-bar')) {
    showSkillPicker.value = false
  }
}

onMounted(() => {
  chatStore.init(props.channel)
  if (props.forceSkill) {
    chatStore.selectSkill(props.forceSkill)
  }
  inputRef.value?.focus()
  document.addEventListener('click', onClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
})

watch(
  () => props.channel,
  (channel) => {
    chatStore.setChannel(channel || 'chat')
  }
)

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

function handleDeleteDialogSelect(value: unknown) {
  if (value === 'confirm') {
    confirmDelete()
  } else {
    deleteTarget.value = null
  }
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

function saveDraft(content: string) {
  const firstLine = content
    .split('\n')
    .find(l => l.trim().length > 0)
    ?.trim() || ''
  const cleaned = firstLine.replace(/^#+\s*/, '').replace(/^[*-]\s*/, '')
  emit('save-draft', {
    title: cleaned.slice(0, 30) || '我的策略',
    content,
  })
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text, { breaks: true }) as string
}
</script>

<style src="./ChatPanel.css" scoped></style>
