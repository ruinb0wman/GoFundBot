// @ts-nocheck
import { ref, watch, computed } from 'vue'
import { fundAPI } from '../services/api'

export function useFundAIAnalysis(
  props: { fundCode: string },
  emit: (event: string, ...args: any[]) => void
) {
  const data = ref(null)
  const loading = ref(false)
  const error = ref(null)
  const streamingContent = ref('')

  watch(data, (newVal) => {
    if (newVal) {
      emit('analysis-complete', newVal)
    }
  })

  const dashboardItems = {
    performance_eval: { label: '业绩评价', icon: 'TrendingUp' },
    manager_ability: { label: '经理能力', icon: 'UserCircle' },
    position_analysis: { label: '持仓结构', icon: 'BarChart3' },
    market_outlook: { label: '后市展望', icon: 'Telescope' }
  }

  const scoreColorClass = computed(() => {
    if (!data.value) return ''
    const s = data.value.sentiment_score
    if (s >= 80) return 'score-excellent'
    if (s >= 60) return 'score-good'
    if (s >= 40) return 'score-normal'
    return 'score-poor'
  })

  const scoreColor = computed(() => {
    if (!data.value) return '#1677ff'
    const s = data.value.sentiment_score
    if (s >= 80) return '#52c41a'
    if (s >= 60) return '#1677ff'
    if (s >= 40) return '#faad14'
    return '#f5222d'
  })

  const scoreProgress = computed(() => {
    if (!data.value) return '0 283'
    const progress = (data.value.sentiment_score / 100) * 283
    return `${progress} 283`
  })

  const parsedReport = computed(() => {
    if (!data.value || !data.value.detailed_report) return ''
    const lines = data.value.detailed_report.split('\n')
    let html = ''
    let inList = false
    lines.forEach(line => {
      line = line.trim()
      if (!line) return
      if (line.startsWith('### ')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<h4>${line.substring(4)}</h4>`
      } else if (line.startsWith('## ')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<h3>${line.substring(3)}</h3>`
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        if (!inList) { html += '<ul>'; inList = true; }
        let content = line.substring(2)
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        html += `<li>${content}</li>`
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        let content = line
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        html += `<p>${content}</p>`
      }
    })
    if (inList) html += '</ul>'
    return html
  })

  const adviceClass = computed(() => {
    if (!data.value) return ''
    const advice = data.value.operation_advice
    if (advice.includes('推荐') || advice.includes('买入')) return 'advice-buy'
    if (advice.includes('减仓') || advice.includes('卖出')) return 'advice-sell'
    return 'advice-hold'
  })

  const adviceIcon = computed(() => {
    if (!data.value) return 'BarChart3'
    const advice = data.value.operation_advice
    if (advice.includes('推荐') || advice.includes('买入')) return 'Rocket'
    if (advice.includes('减仓') || advice.includes('卖出')) return 'TrendingDown'
    return 'Hourglass'
  })

  const getEvalClass = (eval_text) => {
    if (!eval_text) return ''
    if (eval_text === '优秀' || eval_text === '乐观') return 'eval-excellent'
    if (eval_text === '良好') return 'eval-good'
    if (eval_text === '较差' || eval_text === '谨慎' || eval_text === '悲观') return 'eval-poor'
    return 'eval-normal'
  }

  const analyze = async () => {
    if (!props.fundCode) return
    loading.value = true
    error.value = null
    streamingContent.value = ''

    try {
      const baseUrl = '/api'
      const response = await fetch(`${baseUrl}/fund/${props.fundCode}/analyze/stream`, {
        method: 'POST',
        headers: { 'Accept': 'text/event-stream' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = response.body
      if (!body) throw new Error('No response body')
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') continue
            try {
              const parsed = JSON.parse(payload)
              if (parsed.token) {
                streamingContent.value = parsed.full || parsed.token
              }
              if (parsed.error) {
                error.value = parsed.error
                break
              }
            } catch {
              // partial JSON, wait for more data
            }
          }
          if (line.startsWith('event: result')) {
            continue
          }
        }
      }

      const fullResponse = await fundAPI.analyzeFund(props.fundCode)
      if (fullResponse.data.error) {
        error.value = fullResponse.data.error
      } else {
        data.value = fullResponse.data
      }
    } catch {
      try {
        const response = await fundAPI.analyzeFund(props.fundCode)
        if (response.data.error) {
          error.value = response.data.error
        } else {
          data.value = response.data
        }
      } catch (err) {
        error.value = '分析失败: ' + (err.response?.data?.error || err.message)
      }
    } finally {
      loading.value = false
      streamingContent.value = ''
    }
  }

  watch(() => props.fundCode, () => {
    data.value = null
    error.value = null
  })

  return {
    data,
    loading,
    error,
    streamingContent,
    dashboardItems,
    scoreColorClass,
    scoreColor,
    scoreProgress,
    parsedReport,
    adviceClass,
    adviceIcon,
    getEvalClass,
    analyze
  }
}
