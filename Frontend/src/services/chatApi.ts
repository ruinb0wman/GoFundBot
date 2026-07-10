import { db } from '../db'
import type { LLMConfig } from '../composables/useLLMConfig'

export interface ToolCallInfo {
  name: string
  params: Record<string, unknown>
  toolCallId?: string
}

export interface ChatSessionDto {
  id: number
  title: string
  created_time: string | null
  updated_time: string | null
}

export interface ChatMessageDto {
  id: number
  session_id?: number
  role: string
  content: string
  tool_name: string | null
  tool_params_json: string | null
  created_time: string | null
}

export interface SkillInfo {
  name: string
  description: string
}

export interface ChatCallbacks {
  onToken: (token: string, full: string) => void
  onToolStart: (tool: ToolCallInfo) => void
  onToolEnd: (tool: { name: string; duration_ms: number }) => void
  onSkillSelected: (skill: SkillInfo) => void
  onUsage: (inputTokens: number, outputTokens: number, totalTokens: number) => void
  onStatus: (message: string) => void
  onDone: () => void
  onError: (error: string) => void
}

export const chatAPI = {
  async sendMessage(messages: { role: string; content: string }[], callbacks: ChatCallbacks, skill?: string, llmConfig?: LLMConfig) {
    const body = JSON.stringify({ messages, skill, llmConfig })

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (!response.ok) {
      callbacks.onError(`请求失败 (${response.status})`)
      return null
    }

    const reader = response.body?.getReader()
    if (!reader) {
      callbacks.onError('无法读取响应流')
      return null
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let pendingEvent = ''
    let pendingData = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          pendingEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          pendingData = line.slice(6).trim()
        } else if (line === '') {
          if (pendingEvent && pendingData) {
            this._handleEvent(pendingEvent, pendingData, callbacks)
          }
          pendingEvent = ''
          pendingData = ''
        }
      }
    }

    if (pendingEvent && pendingData) {
      this._handleEvent(pendingEvent, pendingData, callbacks)
    }

    return null
  },

  _handleEvent(event: string, data: string, callbacks: ChatCallbacks) {
    try {
      const parsed = JSON.parse(data)

      switch (event) {
        case 'token':
          callbacks.onToken(parsed.token || '', parsed.full || '')
          break
        case 'tool_start':
          callbacks.onToolStart({
            name: parsed.name,
            params: parsed.params || {},
            toolCallId: parsed.tool_call_id,
          })
          break
        case 'tool_end':
          callbacks.onToolEnd({
            name: parsed.name,
            duration_ms: parsed.duration_ms || 0,
          })
          break
        case 'skill_selected':
          callbacks.onSkillSelected({
            name: parsed.name || '',
            description: parsed.description || '',
          })
          break
        case 'usage':
          if (callbacks.onUsage) {
            callbacks.onUsage(parsed.input_tokens || 0, parsed.output_tokens || 0, parsed.total_tokens || 0)
          }
          break
        case 'status':
          if (callbacks.onStatus) {
            callbacks.onStatus(parsed.message || '')
          }
          break
        case 'error':
          callbacks.onError(parsed.message || '未知错误')
          break
        case 'done':
          callbacks.onDone()
          break
      }
    } catch {
      // non-JSON data, ignore
    }
  },

  async getSessions() {
    const sessions = await db.chatSessions
      .orderBy('updatedAt')
      .reverse()
      .toArray()
    return {
      data: sessions.map(s => ({
        id: s.id!,
        title: s.title,
        created_time: null,
        updated_time: null,
      })),
    }
  },

  async createSession() {
    const id = await db.chatSessions.add({
      title: '新对话',
      updatedAt: Date.now(),
    })
    return {
      data: { id, title: '新对话', created_time: null, updated_time: null },
    }
  },

  async deleteSession(sessionId: number) {
    await db.chatSessions.delete(sessionId)
    await db.chatMessages.where({ sessionId }).delete()
  },

  async updateSessionTitle(sessionId: number, title: string) {
    await db.chatSessions.update(sessionId, { title, updatedAt: Date.now() })
  },

  async getMessages(sessionId: number) {
    const messages = await db.chatMessages
      .where({ sessionId })
      .sortBy('createdAt')
    return {
      data: messages.map(m => ({
        id: m.id!,
        session_id: m.sessionId,
        role: m.role,
        content: m.content,
        tool_name: m.toolName,
        tool_params_json: m.toolParamsJson,
        created_time: null,
      })),
    }
  },
}
