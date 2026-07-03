<template>
  <div class="fund-ai-analysis card">
    <div class="header">
      <div class="title-area">
        <span class="icon"><LucideIcon name="Bot" :size="20" /></span>
        <h3>{{ t('fund.aiAnalyze.title') }}</h3>
        <span class="badge" v-if="data">{{ t('fund.aiAnalyze.analyzed') }}</span>
      </div>
      <div class="header-actions">
        <BButton v-if="!loading" type="primary" size="small" @click="analyze">
          <template #icon>
            <LucideIcon :name="data ? 'RefreshCw' : 'Sparkles'" :size="16" />
          </template>
          {{ data ? t('fund.aiAnalyze.retry') : t('fund.aiAnalyze.start') }}
        </BButton>
        <BButton text size="small" @click="$emit('close')" :title="t('common.close')">×</BButton>
      </div>
    </div>

    <div v-if="loading && !streamingContent && !stageMessage" class="loading">
      <div class="loading-animation">
        <div class="spinner"></div>
        <div class="loading-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
      <p class="loading-text">{{ t('fund.aiAnalyze.loading') }}</p>
      <p class="loading-sub">{{ t('fund.aiAnalyze.loadingSub') }}</p>
    </div>

    <div v-if="loading && stageMessage && !streamingContent" class="loading">
      <div class="loading-animation">
        <div class="spinner"></div>
      </div>
      <p class="loading-text">{{ stageMessage }}</p>
    </div>

    <div v-if="loading && streamingContent" class="streaming-output">
      <div class="streaming-header">
        <div class="streaming-dot"></div>
        <span>{{ t('fund.aiAnalyze.generating') }}</span>
      </div>
      <div class="streaming-text">{{ streamingContent }}</div>
    </div>

    <div v-else-if="error" class="error">
      <span class="error-icon"><LucideIcon name="TriangleAlert" :size="20" /></span>
      <p>{{ error }}</p>
      <BButton type="danger" @click="analyze">{{ t('common.retry') }}</BButton>
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
          <div class="score-label">{{ t('fund.aiAnalyze.compositeScore') }}</div>
        </div>
        <div class="advice-card" :class="adviceClass">
          <div class="advice-icon"><LucideIcon :name="adviceIcon" :size="32" /></div>
          <div class="advice-text">{{ data.operation_advice }}</div>
        </div>
      </div>

      <div class="rating-section" v-if="data.rating">
        <div class="rating-badge" :style="{ borderColor: ratingColor, color: ratingColor }">
          <span class="rating-label">{{ ratingLabel }}</span>
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
          <h4><span class="col-icon"><LucideIcon name="Check" :size="16" /></span> {{ t('fund.aiAnalyze.highlights') }}</h4>
          <ul>
            <li v-for="(item, i) in data.highlights" :key="i">
              <span class="bullet">•</span>{{ item }}
            </li>
          </ul>
        </div>
        <div class="detail-col risks">
          <h4><span class="col-icon"><LucideIcon name="TriangleAlert" :size="16" /></span> {{ t('fund.aiAnalyze.risks') }}</h4>
          <ul>
            <li v-for="(item, i) in data.risk_factors" :key="i">
              <span class="bullet">•</span>{{ item }}
            </li>
          </ul>
        </div>
      </div>

      <div class="news-section" v-if="data.news_intel && data.news_intel.length">
        <h4><span class="col-icon"><LucideIcon name="Newspaper" :size="16" /></span> {{ t('fund.aiAnalyze.realtime') }}</h4>
        <ul>
          <li v-for="(news, i) in data.news_intel" :key="i">{{ news }}</li>
        </ul>
      </div>

      <div class="analyst-section" v-if="analystReports && analystReports.length">
        <div class="analyst-header" @click="showAnalysts = !showAnalysts">
          <h4><LucideIcon name="Users" :size="16" /> {{ t('fund.aiAnalyze.analystViews') }} <span class="analyst-count">{{ t('fund.aiAnalyze.analystCount', { count: analystReports.length }) }}</span></h4>
          <span class="toggle-icon">{{ showAnalysts ? '▲' : '▼' }}</span>
        </div>
        <div class="analyst-grid" v-if="showAnalysts">
          <div class="analyst-card" v-for="r in analystReports" :key="r.analyst_role">
            <div class="analyst-role">
              <span class="role-dot" :style="{ background: roleColor(r.analyst_role) }"></span>
              {{ analystRoleNames[r.analyst_role] || r.analyst_role }}
              <span class="role-score">{{ r.score }}/10</span>
            </div>
            <p class="analyst-thesis">{{ r.thesis }}</p>
            <div class="analyst-meta" v-if="r.key_evidence?.length">
              <span class="meta-label">{{ t('fund.aiAnalyze.evidence') }}：</span>
              <div class="meta-tags">
                <span class="evidence-tag" v-for="e in r.key_evidence" :key="e">{{ e }}</span>
              </div>
            </div>
            <div class="analyst-meta" v-if="r.risk_flags?.length">
              <span class="meta-label">{{ t('fund.aiAnalyze.riskFlags') }}：</span>
              <div class="meta-tags">
                <span class="flag-tag" v-for="f in r.risk_flags" :key="f">{{ f }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="detailed-report" v-if="data.detailed_report">
        <div class="report-header">
          <span class="report-icon"><LucideIcon name="FileText" :size="20" /></span>
          <h4>{{ t('fund.aiAnalyze.deepReport') }}</h4>
        </div>
        <div class="markdown-content" v-html="parsedReport"></div>
      </div>

      <div class="disclaimer">
        <LucideIcon name="Lightbulb" :size="16" /> {{ t('fund.aiAnalyze.disclaimer') }}
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon"><LucideIcon name="Telescope" :size="36" /></div>
      <p class="empty-title">{{ t('fund.aiAnalyze.emptyTitle') }}</p>
      <p class="empty-sub">{{ t('fund.aiAnalyze.emptySub') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useFundAIAnalysis } from '../composables/useFundAIAnalysis'
import BButton from './BButton.vue'

const { t } = useI18n()

const props = defineProps({
  fundCode: { type: String, required: true }
})
const emit = defineEmits(['close', 'analysis-complete'])

const {
  data, loading, error, streamingContent,
  stageMessage, analystReports, showAnalysts,
  dashboardItems, ratingLabel, ratingColor,
  scoreColorClass, scoreColor, scoreProgress,
  parsedReport, adviceClass, adviceIcon, getEvalClass,
  analystRoleNames, roleColor, analyze
} = useFundAIAnalysis(props, emit)

defineExpose({ analyze })
</script>

<style src="./FundAIAnalysis.css" scoped></style>
