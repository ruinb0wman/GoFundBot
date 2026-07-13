import { defineStore } from 'pinia'
import { chatAPI, type ChatSessionDto, type ChatMessageDto, type ToolCallInfo, type SkillInfo } from '../services/chatApi'
import { db } from '../db'
import { useLLMConfig } from '../composables/useLLMConfig'

export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCallStatus[]
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
}

export interface ToolCallStatus {
  name: string
  params: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  durationMs?: number
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    sessions: [] as ChatSessionDto[],
    currentSessionId: null as number | null,
    messages: [] as DisplayMessage[],
    isStreaming: false,
    streamingContent: '',
    activeToolCalls: [] as ToolCallStatus[],
    sessionTotalTokens: 0,
    retryMessage: '',
    isOpen: false,
    isWideMode: false,
    initialized: false,
    currentSkill: null as string | null,
    selectedSkill: null as string | null,
    skillOptions: [
      { name: 'auto', label: '自动' },
      { name: 'fund_analysis', label: '基金分析' },
      { name: 'market_overview', label: '市场概览' },
      { name: 'news_briefing', label: '快讯新闻' },
      { name: 'fund_screening', label: '基金筛选' },
      { name: 'investment_strategy', label: '定投策略' },
    ] as { name: string; label: string }[],
  }),

  getters: {
    currentSession(state) {
      return state.sessions.find((s) => s.id === state.currentSessionId) || null
    },

    displayMessages(state): DisplayMessage[] {
      if (state.isStreaming) {
        const msgs = [...state.messages]
        const lastAssistant = msgs.find(
          (m) => m.role === 'assistant' && m.id === '__streaming__'
        )
        if (lastAssistant) {
          lastAssistant.content = state.streamingContent
          lastAssistant.toolCalls = state.activeToolCalls.length > 0 ? state.activeToolCalls : undefined
        } else {
          msgs.push({
            id: '__streaming__',
            role: 'assistant',
            content: state.streamingContent,
            toolCalls: state.activeToolCalls.length > 0 ? [...state.activeToolCalls] : undefined,
          })
        }
        return msgs
      }
      return state.messages
    },
  },

  actions: {
    async init() {
      if (this.initialized) return
      this.initialized = true
      const result = await chatAPI.getSessions()
      this.sessions = result.data || []
      if (this.sessions.length > 0) {
        await this.switchSession(this.sessions[0].id)
      }
    },

    async createSession() {
      try {
        const result = await chatAPI.createSession()
        this.sessions.unshift(result.data)
        await this.switchSession(result.data.id)
        return result.data
      } catch (e) {
        console.error('Failed to create session:', e)
        return null
      }
    },

    async deleteSession(sessionId: number) {
      try {
        await chatAPI.deleteSession(sessionId)
        this.sessions = this.sessions.filter((s) => s.id !== sessionId)
        if (this.currentSessionId === sessionId) {
          if (this.sessions.length > 0) {
            await this.switchSession(this.sessions[0].id)
          } else {
            this.currentSessionId = null
            this.messages = []
          }
        }
      } catch (e) {
        console.error('Failed to delete session:', e)
      }
    },

    async switchSession(sessionId: number) {
      this.currentSessionId = sessionId
      this.isStreaming = false
      this.messages = []
      this.streamingContent = ''
      this.activeToolCalls = []
      this.sessionTotalTokens = 0
      this.retryMessage = ''

      try {
        const result = await chatAPI.getMessages(sessionId)
        const rawMessages: ChatMessageDto[] = result.data || []

        for (const m of rawMessages) {
          if (m.role === 'user' || m.role === 'assistant') {
            this.messages.push({
              id: String(m.id),
              role: m.role as 'user' | 'assistant',
              content: m.content || '',
            })
          }
        }
      } catch (e) {
        console.error('Failed to load messages:', e)
      }
    },

    async sendMessage(message: string) {
      if (this.isStreaming || !message.trim()) return

      if (!this.currentSessionId) {
        const session = await this.createSession()
        if (!session) return
      }

      const conversationMessages: { role: string; content: string }[] = [
        ...this.messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ]

      this.messages.push({
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
      })

      if (this.currentSessionId) {
        await db.chatMessages.add({
          sessionId: this.currentSessionId,
          role: 'user',
          content: message,
          toolName: null,
          toolParamsJson: null,
          createdAt: Date.now(),
        })
        await db.chatSessions.update(this.currentSessionId, { updatedAt: Date.now() })
      }

      this.isStreaming = true
      this.streamingContent = ''
      this.activeToolCalls = []
      this.retryMessage = ''
      this.currentSkill = null

      const skillParam = this.selectedSkill && this.selectedSkill !== 'auto' ? this.selectedSkill : undefined

      await chatAPI.sendMessage(conversationMessages, {
        onToken: (token: string, full: string) => {
          this.streamingContent = full
        },
        onToolStart: (tool: ToolCallInfo) => {
          this.activeToolCalls.push({
            name: tool.name,
            params: tool.params,
            status: 'running',
          })
        },
        onToolEnd: (tool: { name: string; duration_ms: number; error?: boolean }) => {
          const existing = this.activeToolCalls.find((t) => t.name === tool.name && t.status === 'running')
          if (existing) {
            existing.status = tool.error ? 'error' : 'done'
            existing.durationMs = tool.duration_ms
          }
        },
        onSkillSelected: (skill: SkillInfo) => {
          this.currentSkill = skill.name
        },
        onUsage: (inputTokens: number, outputTokens: number, totalTokens: number) => {
          this.sessionTotalTokens += totalTokens
          const streaming = this.messages.find(m => m.id === '__streaming__' || m.role === 'assistant')
          if (streaming) {
            streaming.usage = { inputTokens, outputTokens, totalTokens }
          }
        },
        onStatus: (message: string) => {
          this.retryMessage = message
          setTimeout(() => {
            if (this.retryMessage === message) this.retryMessage = ''
          }, 5000)
        },
        onDone: async () => {
          this.finalizeStream()
          if (this.currentSessionId) {
            const streamingMsg = this.messages.find(m => m.id === '__streaming__' || m.role === 'assistant')
            if (streamingMsg && streamingMsg.content) {
              await db.chatMessages.add({
                sessionId: this.currentSessionId,
                role: 'assistant',
                content: streamingMsg.content,
                toolName: null,
                toolParamsJson: null,
                createdAt: Date.now(),
              })
              await db.chatSessions.update(this.currentSessionId, { updatedAt: Date.now() })
            }
            await this._autoTitleSession(this.currentSessionId, conversationMessages)
          }
          await this.refreshSessions()
        },
        onError: async (error: string) => {
          this.streamingContent = error
          this.finalizeStream()
          if (this.currentSessionId) {
            await db.chatMessages.add({
              sessionId: this.currentSessionId,
              role: 'assistant',
              content: error,
              toolName: null,
              toolParamsJson: null,
              createdAt: Date.now(),
            })
            await db.chatSessions.update(this.currentSessionId, { updatedAt: Date.now() })
            await this._autoTitleSession(this.currentSessionId, conversationMessages)
          }
          await this.refreshSessions()
        },
      }, skillParam, useLLMConfig().config.value)
    },

    finalizeStream() {
      if (this.streamingContent || this.activeToolCalls.length > 0) {
        this.messages.push({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: this.streamingContent,
          toolCalls: this.activeToolCalls.length > 0 ? [...this.activeToolCalls] : undefined,
        })
      }
      this.isStreaming = false
      this.streamingContent = ''
      this.activeToolCalls = []
    },

    async refreshSessions() {
      const result = await chatAPI.getSessions()
      this.sessions = result.data || []
    },

    async _autoTitleSession(sessionId: number, conversationMessages: { role: string; content: string }[]) {
      const title = this.currentSession?.title
      if (title !== '新对话') return
      const firstUser = conversationMessages.find(m => m.role === 'user')
      if (!firstUser) return
      const text = firstUser.content
      const newTitle = text.length > 50 ? text.slice(0, 50) + '...' : text
      await chatAPI.updateSessionTitle(sessionId, newTitle)
    },

    toggleOpen() {
      this.isOpen = !this.isOpen
      if (this.isOpen) {
        this.init()
      }
    },

    close() {
      this.isOpen = false
    },

    toggleWideMode() {
      this.isWideMode = !this.isWideMode
    },

    selectSkill(name: string | null) {
      this.selectedSkill = name
      if (name) {
        this.currentSkill = name
      }
    },
  },
})
