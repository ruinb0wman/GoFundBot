<template>
  <div class="portfolio-ai-analysis card">
    <div class="header">
      <div class="title-area">
        <span class="icon"><LucideIcon name="PieChart" :size="20" /></span>
        <h3>AI 持仓诊断</h3>
        <span class="badge" v-if="data">已分析</span>
      </div>
      <div class="header-actions">
        <BButton v-if="!loading" type="primary" size="small" @click="handleAnalyze">
          <template #icon>
            <LucideIcon :name="data ? 'RefreshCw' : 'Sparkles'" :size="16" />
          </template>
          {{ data ? '重新分析' : '开始诊断' }}
        </BButton>
        <BButton text size="small" @click="$emit('close')">×</BButton>
      </div>
    </div>

    <div v-if="loading" class="loading">
      <div class="loading-animation">
        <div class="spinner"></div>
      </div>
      <p class="loading-text">正在对您的投资组合进行多维诊断...</p>
      <p class="loading-sub">分析行业分布、持仓重叠、仓位合理性等维度</p>
    </div>

    <div v-else-if="error" class="error">
      <span class="error-icon"><LucideIcon name="TriangleAlert" :size="20" /></span>
      <p>{{ error }}</p>
      <BButton type="danger" @click="handleAnalyze">重试</BButton>
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
          <div class="score-label">组合评分</div>
        </div>
        <div class="advice-card" :class="adviceClass">
          <div class="advice-icon"><LucideIcon :name="adviceIcon" :size="32" /></div>
          <div class="advice-text">{{ data.operation_advice }}</div>
        </div>
      </div>

      <div class="rating-section" v-if="data.rating">
        <div class="rating-badge" :style="{ borderColor: ratingColor, color: ratingColor }">
          <span class="rating-label">综合评级</span>
          <span class="rating-code">{{ data.rating }}</span>
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
          <h4><span class="col-icon"><LucideIcon name="Check" :size="16" /></span> 组合亮点</h4>
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

      <div class="detailed-report" v-if="data.detailed_report">
        <div class="report-header">
          <span class="report-icon"><LucideIcon name="FileText" :size="20" /></span>
          <h4>详细诊断报告</h4>
        </div>
        <div class="markdown-content" v-html="parsedReport"></div>
      </div>

      <div class="disclaimer">
        <LucideIcon name="Lightbulb" :size="16" /> 诊断结果由 AI 生成，仅供参考，不构成投资建议。
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon"><LucideIcon name="PieChart" :size="36" /></div>
      <p class="empty-title">组合持仓诊断</p>
      <p class="empty-sub">AI 将分析您的整体持仓结构、行业分布、重叠风险，并给出仓位调整建议</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import LucideIcon from './LucideIcon.vue'
import BButton from './BButton.vue'
import { usePortfolioAIAnalysis } from '../composables/usePortfolioAIAnalysis'

const props = defineProps<{
  funds: Array<{ code: string; share: number; cost: number }>
}>()

const emit = defineEmits<{
  close: []
}>()

const {
  data, loading, error, dashboardItems,
  ratingColor, scoreColorClass, scoreColor, scoreProgress,
  adviceClass, adviceIcon, getEvalClass, parsedReport, analyze,
} = usePortfolioAIAnalysis()

function handleAnalyze() {
  analyze(props.funds)
}
</script>

<style scoped>
.portfolio-ai-analysis { border: 1px solid var(--border-default); border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
.header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--bg-gradient); color: white; }
.title-area { display: flex; align-items: center; gap: 8px; }
.title-area h3 { margin: 0; font-size: 15px; font-weight: 600; }
.badge { background: rgba(255,255,255,.2); padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.loading { text-align: center; padding: 40px 20px; }
.loading-animation { margin-bottom: 16px; }
.spinner { width: 36px; height: 36px; border: 3px solid var(--border-subtle); border-top-color: var(--color-primary); border-radius: 50%; animation: spin .8s linear infinite; margin: 0 auto; }
.loading-text { color: var(--text-primary); font-size: 14px; margin: 0 0 6px; }
.loading-sub { color: var(--text-tertiary); font-size: 12px; margin: 0; }
.error { text-align: center; padding: 40px 20px; }
.error-icon { color: var(--color-danger); margin-bottom: 12px; }
.error p { color: var(--text-primary); margin: 0 0 12px; }
.analysis-content { padding: 16px; }
.score-section { display: flex; gap: 16px; margin-bottom: 16px; }
.score-card { flex: 0 0 130px; text-align: center; padding: 16px; border-radius: 12px; background: var(--bg-subtle); }
.score-ring { position: relative; width: 90px; margin: 0 auto 8px; }
.score-ring svg { width: 90px; height: 90px; }
.score-value { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; color: var(--text-primary); }
.score-label { font-size: 12px; color: var(--text-secondary); }
.score-excellent .score-ring circle:last-child { filter: drop-shadow(0 0 6px #52c41a); }
.score-good .score-ring circle:last-child { filter: drop-shadow(0 0 6px #1677ff); }
.score-normal .score-ring circle:last-child { filter: drop-shadow(0 0 6px #faad14); }
.score-poor .score-ring circle:last-child { filter: drop-shadow(0 0 6px #f5222d); }
.advice-card { flex: 1; display: flex; align-items: center; gap: 14px; padding: 16px 20px; border-radius: 12px; background: var(--bg-subtle); }
.advice-icon { flex-shrink: 0; }
.advice-text { font-size: 18px; font-weight: 700; }
.advice-buy { background: var(--color-success-bg); color: var(--color-success); }
.advice-hold { background: var(--color-warning-bg); color: #d48806; }
.advice-sell { background: var(--color-danger-bg); color: var(--color-danger); }
.rating-section { margin-bottom: 12px; }
.rating-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 1px solid; border-radius: 20px; font-size: 13px; }
.rating-label { color: var(--text-secondary); }
.rating-code { font-weight: 700; font-size: 15px; }
.summary-section { margin-bottom: 16px; }
.summary-section p { margin: 0; line-height: 1.7; color: var(--text-primary); font-size: 13px; text-align: justify; }
.dashboard-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
.dash-item { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 8px; background: var(--bg-subtle); }
.dash-icon { color: var(--color-primary); }
.dash-content label { display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 2px; }
.dash-content span { font-size: 14px; font-weight: 600; }
.eval-excellent { color: #52c41a; }
.eval-good { color: #1677ff; }
.eval-normal { color: #faad14; }
.eval-poor { color: #f5222d; }
.details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.detail-col { padding: 14px; border-radius: 8px; }
.detail-col h4 { margin: 0 0 10px; font-size: 14px; display: flex; align-items: center; gap: 6px; }
.col-icon { display: inline-flex; }
.highlights { background: var(--color-success-bg); }
.highlights h4 { color: #389e0d; }
.risks { background: var(--color-danger-bg); }
.risks h4 { color: #cf1322; }
.detail-col ul { list-style: none; margin: 0; padding: 0; }
.detail-col li { font-size: 13px; color: var(--text-primary); margin-bottom: 6px; line-height: 1.5; }
.bullet { margin-right: 6px; font-weight: 700; }
.highlights .bullet { color: #389e0d; }
.risks .bullet { color: #cf1322; }
.detailed-report { margin-top: 16px; padding: 16px; border-radius: 8px; background: var(--bg-page); }
.report-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.report-header h4 { margin: 0; font-size: 15px; }
.report-icon { color: var(--color-primary); }
.markdown-content { font-size: 13px; line-height: 1.8; color: var(--text-primary); }
.markdown-content :deep(h3) { font-size: 16px; margin: 16px 0 8px; }
.markdown-content :deep(h4) { font-size: 14px; margin: 12px 0 6px; }
.markdown-content :deep(ul) { padding-left: 20px; margin: 6px 0; }
.markdown-content :deep(li) { margin-bottom: 4px; }
.disclaimer { display: flex; align-items: center; gap: 8px; margin-top: 16px; padding: 10px 14px; border-radius: 8px; background: var(--bg-subtle); color: var(--text-tertiary); font-size: 12px; }
.empty-state { text-align: center; padding: 40px 20px; }
.empty-icon { color: var(--text-tertiary); margin-bottom: 12px; }
.empty-title { color: var(--text-primary); font-size: 16px; font-weight: 600; margin: 0 0 6px; }
.empty-sub { color: var(--text-secondary); font-size: 13px; margin: 0; line-height: 1.6; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
