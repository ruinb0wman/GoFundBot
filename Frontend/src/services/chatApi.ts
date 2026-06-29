import api from './api'

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

export interface ChatCallbacks {
  onToken: (token: string, full: string) => void
  onToolStart: (tool: ToolCallInfo) => void
  onToolEnd: (tool: { name: string; duration_ms: number }) => void
  onDone: () => void
  onError: (error: string) => void
}

export const chatAPI = {
  async sendMessage(sessionId: number | null, message: string, callbacks: ChatCallbacks) {
    const body = JSON.stringify({ session_id: sessionId, message })

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

    // Handle any remaining data in buffer
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
    const response = await api.get('/chat/sessions')
    return response.data as { data: ChatSessionDto[] }
  },

  async createSession() {
    const response = await api.post('/chat/sessions')
    return response.data as { data: ChatSessionDto }
  },

  async deleteSession(sessionId: number) {
    await api.delete(`/chat/sessions/${sessionId}`)
  },

  async updateSessionTitle(sessionId: number, title: string) {
    await api.patch(`/chat/sessions/${sessionId}`, { title })
  },

  async getMessages(sessionId: number) {
    const response = await api.get(`/chat/sessions/${sessionId}/messages`)
    return response.data as { data: ChatMessageDto[] }
  },
}
