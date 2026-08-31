// @ts-nocheck
import { ref, watch, computed } from 'vue'
import { fundAPI } from '../services/api'
import type { AnalystReport, FundAnalysisResult } from '../types'
import { storeAnalysis, resolvePending, getPastContext } from '../db/analysisMemory'
import { buildActiveStrategyContext } from '../db/strategyMemory'

export function useFundAIAnalysis<T extends (...args: any[]) => any>(
  props: { fundCode: string },
  emit: T
) {
  const data = ref<FundAnalysisResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const streamingContent = ref('')
  const stageMessage = ref('')
  const analystReports = ref<AnalystReport[]>([])
  const showAnalysts = ref(true)

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

  const ratingMap: Record<string, string> = {
    'Strong Buy': '强烈看多',
    'Buy': '建议买入',
    'Hold': '持有观望',
    'Underweight': '建议减仓',
    'Sell': '建议卖出',
  }

  const ratingColorMap: Record<string, string> = {
    'Strong Buy': '#cf1322',
    'Buy': '#52c41a',
    'Hold': '#faad14',
    'Underweight': '#fa8c16',
    'Sell': '#8c8c8c',
  }

  const ratingLabel = computed(() => {
    return ratingMap[data.value?.rating || ''] || data.value?.rating || ''
  })

  const ratingColor = computed(() => {
    return ratingColorMap[data.value?.rating || ''] || '#1677ff'
  })

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

  const getEvalClass = (eval_text: string) => {
    if (!eval_text) return ''
    if (eval_text === '优秀' || eval_text === '乐观') return 'eval-excellent'
    if (eval_text === '良好') return 'eval-good'
    if (eval_text === '较差' || eval_text === '谨慎' || eval_text === '悲观') return 'eval-poor'
    return 'eval-normal'
  }

  const analystRoleNames: Record<string, string> = {
    performance: '业绩分析师',
    holding: '持仓分析师',
    manager: '经理分析师',
    market: '市场环境分析师',
  }

  const roleColorMap: Record<string, string> = {
    performance: '#1677ff',
    holding: '#52c41a',
    manager: '#722ed1',
    market: '#fa8c16',
  }

  const roleColor = (role: string): string => {
    return roleColorMap[role] || '#8c8c8c'
  }

  const analyze = async () => {
    if (!props.fundCode) return
    loading.value = true
    error.value = null
    streamingContent.value = ''
    stageMessage.value = '正在查询历史分析记录...'
    analystReports.value = []
    showAnalysts.value = true

    try {
      // resolve old pending analyses + get past context
      let pastContext = ''
      try {
        const detailResp = await fundAPI.getFundDetail(props.fundCode)
        const perf = detailResp.data?.data?.sections?.performance?.data
        const currentReturn = perf?.return1m ?? (perf?.return3m != null ? perf.return3m / 3 : null)
        if (currentReturn != null) {
          await resolvePending(props.fundCode, currentReturn)
        }
        pastContext = await getPastContext(props.fundCode)
      } catch { /* non-critical, continue without memory */ }

      const strategyContext = await buildActiveStrategyContext()

      const baseUrl = '/api'
      const response = await fetch(`${baseUrl}/fund/${props.fundCode}/analyze/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ pastContext: pastContext || undefined, strategyContext: strategyContext || undefined }),
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
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]

          if (line.startsWith('event: stage')) {
            // next line is data: with stage info
            if (i + 1 < lines.length && lines[i + 1].startsWith('data: ')) {
              const payload = lines[i + 1].slice(6).trim()
              try {
                const parsed = JSON.parse(payload)
                stageMessage.value = parsed.message || ''
              } catch { /* ignore */ }
            }
            continue
          }

          if (line.startsWith('event: result')) {
            // next line is data: with full result
            if (i + 1 < lines.length && lines[i + 1].startsWith('data: ')) {
              const payload = lines[i + 1].slice(6).trim()
              try {
                const parsed = JSON.parse(payload)
                data.value = parsed
                analystReports.value = parsed.analyst_reports || []
                // store analysis memory asynchronously
                storeAnalysis(props.fundCode, parsed)
              } catch { /* ignore */ }
            }
            continue
          }

          if (line.startsWith('event: done')) {
            continue
          }

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
        }
      }

      // If SSE didn't yield a result, fall back to GET
      if (!data.value && !error.value) {
        const fullResponse = await fundAPI.analyzeFund(props.fundCode)
        if (fullResponse.data.error) {
          error.value = fullResponse.data.error
        } else {
          data.value = fullResponse.data
          analystReports.value = fullResponse.data.analyst_reports || []
          storeAnalysis(props.fundCode, fullResponse.data)
        }
      }
    } catch {
      // Fallback: use GET API
      try {
        const response = await fundAPI.analyzeFund(props.fundCode)
        if (response.data.error) {
          error.value = response.data.error
        } else {
          data.value = response.data
          analystReports.value = response.data.analyst_reports || []
        }
      } catch (err) {
        error.value = '分析失败: ' + (err.response?.data?.error || err.message)
      }
    } finally {
      loading.value = false
      streamingContent.value = ''
      stageMessage.value = ''
    }
  }

  watch(() => props.fundCode, () => {
    data.value = null
    error.value = null
    analystReports.value = []
  })

  return {
    data,
    loading,
    error,
    streamingContent,
    stageMessage,
    analystReports,
    showAnalysts,
    dashboardItems,
    ratingLabel,
    ratingColor,
    scoreColorClass,
    scoreColor,
    scoreProgress,
    parsedReport,
    adviceClass,
    adviceIcon,
    getEvalClass,
    analystRoleNames,
    roleColor,
    analyze
  }
}
