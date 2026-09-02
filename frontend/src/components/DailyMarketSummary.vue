<template>
  <div class="daily-market-summary">
    <div class="summary-header">
      <div class="header-left">
        <h3><LucideIcon name="Calendar" :size="20" /> {{ '每日市场行情' }}</h3>
        <span class="date">{{ today }}</span>
      </div>
      <div class="header-actions">
        <BButton v-if="data && !loading" type="primary" size="small" icon="RefreshCw" @click="refresh" :title="'刷新'">{{ '刷新' }}</BButton>
      </div>
    </div>

    <!-- 加载中状态 - 步骤可视化 -->
    <div v-if="loading" class="loading-container">
      <div class="progress-card">
        <div class="progress-header">
          <div class="pulse-dot"></div>
          <span>{{ '正在生成今日市场分析' }}</span>
        </div>

        <!-- 步骤列表 -->
        <div class="steps-container">
          <div
            v-for="step in steps"
            :key="step.step"
            class="step-item"
            :class="getStepClass(step.step)"
          >
            <div class="step-indicator">
              <div class="step-circle">
                <span v-if="currentStep > step.step" class="check-icon"><LucideIcon name="Check" :size="14" /></span>
                <span v-else-if="currentStep === step.step" class="loading-spinner"></span>
                <span v-else class="step-number">{{ step.step }}</span>
              </div>
              <div v-if="step.step < 3" class="step-line" :class="{ active: currentStep > step.step }"></div>
            </div>
            <div class="step-content">
              <div class="step-name">{{ step.name }}</div>
              <div class="step-description">{{ step.description }}</div>
            </div>
          </div>
        </div>

        <!-- 当前状态消息 -->
        <div class="current-status">
          <div class="status-message">{{ stepMessage }}</div>
          <div class="status-hint">{{ '首次生成可能需要30-60秒，请耐心等待...' }}</div>
        </div>
      </div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="error-container">
      <div class="error-card">
        <div class="error-icon"><LucideIcon name="TriangleAlert" :size="24" /></div>
        <div class="error-message">{{ error }}</div>
        <BButton type="danger" size="small" @click="() => fetchData(false)">{{ '重新生成' }}</BButton>
      </div>
    </div>

    <!-- 数据展示 -->
    <div v-else-if="data" class="summary-content">
      <div class="market-sentiment" :class="sentimentClass">
        <span class="sentiment-icon"><LucideIcon :name="sentimentIcon" :size="24" /></span>
        <span class="sentiment-label">{{ '市场情绪：' }}</span>
        <span class="sentiment-value">{{ data.market_sentiment }}</span>
      </div>

      <div class="summary-text">
        <div class="summary-icon"><LucideIcon name="Lightbulb" :size="20" /></div>
        <div class="summary-body">{{ data.summary }}</div>
      </div>

      <div class="indices-grid">
        <div v-for="(idx, index) in data.indices" :key="index" class="index-card">
          <div class="index-header">
            <span class="index-icon"><LucideIcon name="BarChart3" :size="16" /></span>
            <span class="index-name">{{ idx.name }}</span>
          </div>
          <div class="index-change" :class="getChangeClass(idx.change)">{{ idx.change }}</div>
          <div class="index-analysis">{{ idx.analysis }}</div>
        </div>
      </div>

      <div class="sections">
        <div class="section hot-sectors">
          <h4><span class="section-icon"><LucideIcon name="Flame" :size="16" /></span> {{ '热门板块' }}</h4>
          <div class="tags">
            <span v-for="(sector, i) in data.hot_sectors" :key="i" class="tag">{{ sector }}</span>
          </div>
        </div>

        <div class="section key-news">
          <h4><span class="section-icon"><LucideIcon name="Newspaper" :size="16" /></span> {{ '关键新闻' }}</h4>
          <ul class="news-list">
            <li v-for="(news, i) in data.key_news" :key="i">
              <span class="news-bullet">•</span>
              {{ news }}
            </li>
          </ul>
        </div>

        <div class="section outlook">
          <h4><span class="section-icon"><LucideIcon name="Telescope" :size="16" /></span> {{ '后市展望' }}</h4>
          <p class="outlook-text">{{ data.outlook }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>

import { BButton } from '@gofund/ui'
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { fundAPI } from '../services/api'

const data = ref(null)
const loading = ref(false)
const error = ref(null)
const currentStep = ref(0)
const stepMessage = ref('正在初始化...')
const steps = ref([
  { step: 1, name: '搜索新闻', description: '获取今日财经资讯' },
  { step: 2, name: 'AI 分析', description: '生成市场分析报告' },
  { step: 3, name: '完成', description: '分析报告已就绪' }
])

const today = new Date().toLocaleDateString('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long'
})

// 轮询相关
let pollTimer = null
const POLL_INTERVAL = 2500  // 2.5秒轮询一次
const MAX_POLL_COUNT = 120  // 最多轮询120次（5分钟）
let pollCount = 0

const sentimentClass = computed(() => {
  if (!data.value) return ''
  const s = data.value.market_sentiment || ''
  if (s.includes('积极') || s.includes('乐观') || s.includes('看多')) return 'sentiment-positive'
  if (s.includes('恐慌') || s.includes('悲观') || s.includes('看空')) return 'sentiment-negative'
  return 'sentiment-neutral'
})

const sentimentIcon = computed(() => {
    if (!data.value) return 'TrendingUp'
    const s = data.value.market_sentiment || ''
    if (s.includes('积极') || s.includes('乐观') || s.includes('看多')) return 'Rocket'
    if (s.includes('恐慌') || s.includes('悲观') || s.includes('看空')) return 'TrendingDown'
    return 'BarChart3'
})

const getStepClass = (step) => {
  if (currentStep.value > step) return 'completed'
  if (currentStep.value === step) return 'active'
  return 'pending'
}

const getChangeClass = (change) => {
  if (!change) return ''
  if (change.includes('+') || change.includes('涨')) return 'change-up'
  if (change.includes('-') || change.includes('跌')) return 'change-down'
  return ''
}

const stopPolling = () => {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  pollCount = 0
}

const fetchData = async (forceRefresh = false) => {
  // 如果当前是手动重试且已经失败，重置 error 状态
  if (error.value) {
    error.value = null
  }
  loading.value = true

  try {
    const response = await fundAPI.getDailyMarket(forceRefresh)

    // 如果返回 200 成功，且不是 loading
    if (response.status === 200 && !response.data.loading) {
      stopPolling()
      data.value = response.data
      loading.value = false
      return
    }

    // 处理加载中状态 (202 或 data 中带 loading)
    if (response.status === 202 || response.data.loading) {
      currentStep.value = response.data.current_step || 1
      stepMessage.value = response.data.step_message || '正在生成...'

      pollCount++
      if (pollCount < MAX_POLL_COUNT) {
        // 使用动态间隔：前10次快一些，后面慢一些以减少服务器压力
        const nextInterval = pollCount < 10 ? 2000 : POLL_INTERVAL
        pollTimer = setTimeout(() => fetchData(false), nextInterval)
      } else {
        stopPolling()
        error.value = '行情生成时间较长，请稍后刷新页面查看。'
        loading.value = false
      }
      return
    }

    // 处理后端明确返回的错误
    if (response.data.error) {
      stopPolling()
      error.value = response.data.error
      loading.value = false
      return
    }

  } catch (err) {
    // 处理 Axios 错误响应
    const status = err.response?.status
    const responseData = err.response?.data

    if (status === 202 || responseData?.loading) {
      currentStep.value = responseData?.current_step || 1
      stepMessage.value = responseData?.step_message || '正在生成...'
      pollCount++
      if (pollCount < MAX_POLL_COUNT) {
        pollTimer = setTimeout(() => fetchData(false), POLL_INTERVAL)
      } else {
        stopPolling()
        error.value = '请求排队中，请稍后重试'
        loading.value = false
      }
      return
    }

    stopPolling()
    // 这种情况下通常是网络中断或 500 错误
    error.value = '服务器连接异常，请检查网络或后端状态'
    loading.value = false
  }
}

const refresh = () => {
  stopPolling()
  data.value = null
  currentStep.value = 0
  stepMessage.value = '正在初始化...'
  fetchData(true)
}

onMounted(() => {
  fetchData()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style src="./DailyMarketSummary.css" scoped></style>
