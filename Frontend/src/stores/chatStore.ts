import { defineStore } from 'pinia'
import { chatAPI, type ChatSessionDto, type ChatMessageDto, type ToolCallInfo } from '../services/chatApi'

export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCallStatus[]
}

export interface ToolCallStatus {
  name: string
  params: Record<string, unknown>
  status: 'running' | 'done'
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
    isOpen: false,
    initialized: false,
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
      try {
        const result = await chatAPI.getSessions()
        this.sessions = result.data || []
        if (this.sessions.length > 0) {
          await this.switchSession(this.sessions[0].id)
        }
      } catch {
        // no sessions yet
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
      this.messages = []
      this.streamingContent = ''
      this.activeToolCalls = []

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

      // Ensure we have a session
      if (!this.currentSessionId) {
        const session = await this.createSession()
        if (!session) return
      }

      // Add user message
      this.messages.push({
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
      })

      // Start streaming
      this.isStreaming = true
      this.streamingContent = ''
      this.activeToolCalls = []

      await chatAPI.sendMessage(this.currentSessionId, message, {
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
        onToolEnd: (tool: { name: string; duration_ms: number }) => {
          const existing = this.activeToolCalls.find((t) => t.name === tool.name && t.status === 'running')
          if (existing) {
            existing.status = 'done'
            existing.durationMs = tool.duration_ms
          }
        },
        onDone: () => {
          this.finalizeStream()
        },
        onError: (error: string) => {
          this.streamingContent = error
          this.finalizeStream()
        },
      })
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

    toggleOpen() {
      this.isOpen = !this.isOpen
      if (this.isOpen) {
        this.init()
      }
    },

    close() {
      this.isOpen = false
    },
  },
})
