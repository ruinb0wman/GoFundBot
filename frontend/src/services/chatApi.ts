import { db } from '../db'
import type { LLMConfig } from '../composables/useLLMConfig'
import { chat, type ChatStreamEvent } from './chatEngine'
import { useAppSettings } from '../composables/useAppSettings'

export interface ToolCallInfo {
  name: string
  params: Record<string, unknown>
  toolCallId?: string
}

export interface ChatSessionDto {
  id: number
  title: string
  updated_at: number
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
  onToolEnd: (tool: { name: string; duration_ms: number; error?: boolean }) => void
  onSkillSelected: (skill: SkillInfo) => void
  onUsage: (inputTokens: number, outputTokens: number, totalTokens: number) => void
  onStatus: (message: string) => void
  onDone: () => void
  onError: (error: string) => void
}

export const chatAPI = {
  async sendMessage(messages: { role: string; content: string }[], callbacks: ChatCallbacks, skill?: string, llmConfig?: LLMConfig, strategyContext?: string) {
    const searchSettings = useAppSettings().settings.value
    try {
      for await (const event of chat({
        messages,
        skill,
        llmConfig,
        strategyContext,
        searchSettings,
      })) {
        this._handleEvent(event, callbacks)
      }
    } catch (err) {
      callbacks.onError(String(err))
      callbacks.onDone()
    }
    return null
  },

  _handleEvent(event: ChatStreamEvent, callbacks: ChatCallbacks) {
    const type = event.event
    const data = event.data
    try {
      const parsed = JSON.parse(data || '{}')

      switch (type) {
        case 'token':
          callbacks.onToken(parsed.token || '', parsed.full || '')
          break
        case 'tool_start':
          callbacks.onToolStart({
            name: parsed.name,
            params: parsed.params || {},
            toolCallId: parsed.tool_call_id || '',
          })
          break
        case 'tool_end':
          callbacks.onToolEnd({
            name: parsed.name,
            duration_ms: parsed.duration_ms || 0,
            error: !!parsed.error,
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

  async getSessions(channel = 'chat') {
    const sessions = await db.chatSessions
      .orderBy('updatedAt')
      .reverse()
      .toArray()
    return {
      data: sessions
        .filter(s => channel === 'chat' ? (!s.channel || s.channel === 'chat') : s.channel === channel)
        .map(s => ({
          id: s.id!,
          title: s.title,
          updated_at: s.updatedAt,
        })),
    }
  },

  async createSession(channel = 'chat') {
    const id = await db.chatSessions.add({
      title: '新对话',
      updatedAt: Date.now(),
      channel,
    })
    return {
      data: { id, title: '新对话', updated_at: Date.now() },
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
