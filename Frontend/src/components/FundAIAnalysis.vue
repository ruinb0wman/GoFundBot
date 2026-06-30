<template>
  <div class="fund-ai-analysis card">
    <div class="header">
      <div class="title-area">
        <span class="icon"><LucideIcon name="Bot" :size="20" /></span>
        <h3>AI 智能分析</h3>
        <span class="badge" v-if="data">已分析</span>
      </div>
      <div class="header-actions">
        <button v-if="!loading" @click="analyze" class="analyze-btn" :class="{ 'has-data': data }">
          <span class="btn-icon"><LucideIcon :name="data ? 'RefreshCw' : 'Sparkles'" :size="16" /></span>
          {{ data ? '重新分析' : '开始分析' }}
        </button>
        <button class="close-btn" @click="$emit('close')" title="关闭">×</button>
      </div>
    </div>

    <div v-if="loading && !streamingContent" class="loading">
      <div class="loading-animation">
        <div class="spinner"></div>
        <div class="loading-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
      <p class="loading-text">AI 正在深度分析基金表现(可能需要2-3分钟)...</p>
      <p class="loading-sub">结合市场数据、基金业绩、持仓结构进行综合评估</p>
    </div>

    <div v-if="loading && streamingContent" class="streaming-output">
      <div class="streaming-header">
        <div class="streaming-dot"></div>
        <span>AI 分析生成中...</span>
      </div>
      <div class="streaming-text">{{ streamingContent }}</div>
    </div>

    <div v-else-if="error" class="error">
      <span class="error-icon"><LucideIcon name="TriangleAlert" :size="20" /></span>
      <p>{{ error }}</p>
      <button @click="analyze" class="retry-btn">重试</button>
    </div>

    <div v-else-if="data" class="analysis-content">
      <div class="score-section">
        <div class="score-card" :class="scoreColorClass">
          <div class="score-ring">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border-default)" stroke-width="8"/>
              <circle cx="50" cy="50" r="45" fill="none" :stroke="scoreColor" stroke-width="8"
                      :stroke-dasharray="scoreProgress" stroke-linecap="round"
                      transform="rotate(-90 50 50)"/>
            </svg>
            <div class="score-value">{{ data.sentiment_score }}</div>
          </div>
          <div class="score-label">综合评分</div>
        </div>
        <div class="advice-card" :class="adviceClass">
          <div class="advice-icon"><LucideIcon :name="adviceIcon" :size="32" /></div>
          <div class="advice-text">{{ data.operation_advice }}</div>
        </div>
      </div>

      <div class="summary-section">
        <p>{{ data.summary }}</p>
      </div>

      <div class="dashboard-grid">
        <div class="dash-item" v-for="(item, key) in dashboardItems" :key="key">
          <div class="dash-icon"><LucideIcon :name="item.icon" :size="18" /></div>
          <div class="dash-content">
            <label>{{ item.label }}</label>
            <span :class="getEvalClass(data.dashboard[key])">{{ data.dashboard[key] }}</span>
          </div>
        </div>
      </div>

      <div class="details-grid">
        <div class="detail-col highlights">
          <h4><span class="col-icon"><LucideIcon name="Check" :size="16" /></span> 投资亮点</h4>
          <ul>
            <li v-for="(item, i) in data.highlights" :key="i">
              <span class="bullet">•</span>{{ item }}
            </li>
          </ul>
        </div>
        <div class="detail-col risks">
          <h4><span class="col-icon"><LucideIcon name="TriangleAlert" :size="16" /></span> 风险提示</h4>
          <ul>
            <li v-for="(item, i) in data.risk_factors" :key="i">
              <span class="bullet">•</span>{{ item }}
            </li>
          </ul>
        </div>
      </div>

      <div class="news-section" v-if="data.news_intel && data.news_intel.length">
        <h4><span class="col-icon"><LucideIcon name="Newspaper" :size="16" /></span> 实时情报</h4>
        <ul>
          <li v-for="(news, i) in data.news_intel" :key="i">{{ news }}</li>
        </ul>
      </div>

      <div class="detailed-report" v-if="data.detailed_report">
        <div class="report-header">
          <span class="report-icon"><LucideIcon name="FileText" :size="20" /></span>
          <h4>深度分析报告</h4>
        </div>
        <div class="markdown-content" v-html="parsedReport"></div>
      </div>

      <div class="disclaimer">
        <LucideIcon name="Lightbulb" :size="16" /> 以上分析由 AI 生成，仅供参考，不构成投资建议。投资有风险，入市需谨慎。
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon"><LucideIcon name="Telescope" :size="36" /></div>
      <p class="empty-title">点击上方按钮，获取 AI 对该基金的实时深度分析报告</p>
      <p class="empty-sub">分析内容包括：业绩评价、经理能力、持仓分析、后市展望等</p>
    </div>
  </div>
</template>

<script setup>
import { useFundAIAnalysis } from '../composables/useFundAIAnalysis'

const props = defineProps({
  fundCode: { type: String, required: true }
})
const emit = defineEmits(['close', 'analysis-complete'])

const {
  data, loading, error, streamingContent,
  dashboardItems, scoreColorClass, scoreColor, scoreProgress,
  parsedReport, adviceClass, adviceIcon, getEvalClass, analyze
} = useFundAIAnalysis(props, emit)

defineExpose({ analyze })
</script>

<style src="./FundAIAnalysis.css" scoped></style>
