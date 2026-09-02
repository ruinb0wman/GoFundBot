import { ref, computed } from 'vue'
import type { FundAnalysisResult, AnalystReport } from '../types'
import { buildActiveStrategyContext } from '../db/strategyMemory'
import { analyzePortfolio } from '../services/portfolioAnalyst'
import { useLLMConfig } from './useLLMConfig'

export function usePortfolioAIAnalysis() {
  const data = ref<FundAnalysisResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const ratingColorMap: Record<string, string> = {
    'Strong Buy': '#cf1322',
    'Buy': '#52c41a',
    'Hold': '#faad14',
    'Underweight': '#fa8c16',
    'Sell': '#8c8c8c',
  }

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

  const adviceClass = computed(() => {
    if (!data.value) return ''
    const a = data.value.operation_advice
    if (a.includes('推荐') || a.includes('买入')) return 'advice-buy'
    if (a.includes('减仓') || a.includes('卖出')) return 'advice-sell'
    return 'advice-hold'
  })

  const adviceIcon = computed(() => {
    if (!data.value) return 'BarChart3'
    const a = data.value.operation_advice
    if (a.includes('推荐') || a.includes('买入')) return 'Rocket'
    if (a.includes('减仓') || a.includes('卖出')) return 'TrendingDown'
    return 'Hourglass'
  })

  const getEvalClass = (eval_text: string) => {
    if (!eval_text) return ''
    if (eval_text === '优秀' || eval_text === '乐观') return 'eval-excellent'
    if (eval_text === '良好') return 'eval-good'
    if (eval_text === '较差' || eval_text === '谨慎' || eval_text === '悲观') return 'eval-poor'
    return 'eval-normal'
  }

  const dashboardItems = {
    performance_eval: { label: '组合表现', icon: 'TrendingUp' },
    manager_ability: { label: '分散程度', icon: 'Share2' },
    position_analysis: { label: '持仓结构', icon: 'BarChart3' },
    market_outlook: { label: '市场判断', icon: 'Telescope' },
  }

  const parsedReport = computed(() => {
    if (!data.value || !data.value.detailed_report) return ''
    const lines = data.value.detailed_report.split('\n')
    let html = ''
    let inList = false
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      if (line.startsWith('### ')) {
        if (inList) { html += '</ul>'; inList = false }
        html += `<h4>${line.substring(4)}</h4>`
      } else if (line.startsWith('## ')) {
        if (inList) { html += '</ul>'; inList = false }
        html += `<h3>${line.substring(3)}</h3>`
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        if (!inList) { html += '<ul>'; inList = true }
        html += `<li>${line.substring(2)}</li>`
      } else {
        if (inList) { html += '</ul>'; inList = false }
        html += `<p>${line}</p>`
      }
    }
    if (inList) html += '</ul>'
    return html
  })

  const analyze = async (funds: Array<{ code: string; share: number; cost: number; weight_pct?: number }>) => {
    if (!funds.length) return
    loading.value = true
    error.value = null
    data.value = null

    // Calculate weight_pct for each fund
    const totalValue = funds.reduce((sum, f) => sum + (f.share * f.cost || 0), 0)
    const body: Record<string, unknown> = {
      funds: funds.map(f => ({
        code: f.code,
        share: f.share,
        cost: f.cost,
        weight_pct: f.weight_pct ?? (totalValue > 0 ? ((f.share * f.cost || 0) / totalValue) * 100 : 0),
      })),
    }

    const strategyContext = await buildActiveStrategyContext()
    if (strategyContext) {
      body.strategyContext = strategyContext
    }

    const llmConfig = useLLMConfig().config.value

    try {
      const result = await analyzePortfolio(body as { funds: Array<{ code: string; share: number; cost: number; weight_pct?: number }>; strategyContext?: string }, llmConfig)
      data.value = result as unknown as FundAnalysisResult
    } catch (e: any) {
      error.value = e.message || '组合诊断失败'
    } finally {
      loading.value = false
    }
  }

  return {
    data,
    loading,
    error,
    dashboardItems,
    ratingColor,
    scoreColorClass,
    scoreColor,
    scoreProgress,
    adviceClass,
    adviceIcon,
    getEvalClass,
    parsedReport,
    analyze,
  }
}
