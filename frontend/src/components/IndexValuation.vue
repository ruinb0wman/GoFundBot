<template>
  <div class="valuation-section">
    <div class="valuation-header">
      <h3 class="valuation-title">{{ '估值' }}</h3>
      <span v-if="available && metaLine" class="valuation-meta">{{ metaLine }}</span>
    </div>

    <div v-if="loading" class="valuation-placeholder">{{ '加载中...' }}</div>
    <div v-else-if="!available" class="valuation-placeholder">{{ '暂无估值数据（' + unavailableReason + '）' }}</div>
    <template v-else>
      <div class="valuation-grid">
        <div class="valuation-item">
          <span class="valuation-label">{{ '当前PE' }}</span>
          <span class="valuation-value">{{ fmtNumber(data!.pe, 2) }}</span>
        </div>
        <div class="valuation-item" :title="'当前 PE 在窗口内的排名（0% = 窗口最低，100% = 窗口最高）'">
          <span class="valuation-label">{{ '分位' }}</span>
          <span class="valuation-value">{{ percentileText }}</span>
        </div>
        <div v-for="band in bandItems" :key="band.label" class="valuation-item" :title="band.tip">
          <span class="valuation-label">{{ band.label }}</span>
          <span class="valuation-value">{{ fmtNumber(band.value, 2) }}</span>
        </div>
      </div>

      <div v-if="data!.percentile != null" class="percentile-bar">
        <span v-for="tick in TICKS" :key="tick" class="percentile-tick" :style="{ left: tick + '%' }"></span>
        <span class="percentile-pointer" :style="{ left: pointerLeft }"></span>
      </div>
      <div class="valuation-note">{{ '分位越高代表当前估值越贵；历史分位不构成买卖建议。' }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { marketAPI } from '../services/api'
import { fmtNumber } from '../utils/number'

/**
 * 指数估值卡：当前 PE + 窗口分位 + 机会/中位/危险值（= 20/50/80 分位 PE）。
 *
 * 口径陷阱见 docs/market-index-valuation.md：跨源（加权/等权、月频/周频）差 1–2 倍，
 * 所以来源、窗口、分位定义必须写在卡片上，取不到就老实说「暂无」。
 */

interface IndexValuation {
  code: string
  as_of: string
  data_status: 'available' | 'unavailable'
  pe: number | null
  percentile: number | null
  bands: { opportunity: number | null; median: number | null; danger: number | null }
  source: string
  definition: string
  window: { start: string; end: string; points: number; freq: string } | null
  error?: string
}

const props = defineProps<{ indexCode: string }>()

const TICKS = [20, 50, 80]
const SOURCE_LABELS: Record<string, string> = { danjuan: '蛋卷' }

const loading = ref(true)
const data = ref<IndexValuation | null>(null)
const loadError = ref('')

const available = computed(() => data.value?.data_status === 'available')

const percentileText = computed(() =>
  data.value?.percentile == null ? '--' : `${(data.value.percentile * 100).toFixed(1)}%`
)

const pointerLeft = computed(() => {
  const pct = (data.value?.percentile ?? 0) * 100
  return `${Math.min(100, Math.max(0, pct))}%`
})

const unavailableReason = computed(() => loadError.value || data.value?.error || '数据源未收录')

const metaLine = computed(() => {
  const item = data.value
  if (!item) return ''
  const source = SOURCE_LABELS[item.source] ?? item.source
  const window = item.window
  const range = window ? `${window.start}~${window.end}（${window.points} 点周频）` : ''
  return [source, item.definition, range].filter(Boolean).join(' · ')
})

const bandItems = computed(() => {
  const bands = data.value?.bands
  return [
    { label: '机会值', value: bands?.opportunity ?? null, tip: '窗口内 PE 的 20% 分位值（不是目标价，也不是买卖信号）' },
    { label: '中位值', value: bands?.median ?? null, tip: '窗口内 PE 的 50% 分位值（不是目标价，也不是买卖信号）' },
    { label: '危险值', value: bands?.danger ?? null, tip: '窗口内 PE 的 80% 分位值（不是目标价，也不是买卖信号）' },
  ]
})

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await marketAPI.getIndexValuation(props.indexCode)
    if (res.data?.success) {
      data.value = res.data.data as IndexValuation
    } else {
      data.value = null
      loadError.value = '接口返回异常'
    }
  } catch {
    data.value = null
    loadError.value = '取数失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

watch(() => props.indexCode, load)
onMounted(load)
</script>

<style scoped>
.valuation-section {
  margin-top: 16px;
  padding: 16px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}

.valuation-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}

.valuation-title {
  margin: 0;
  font-size: 1em;
  font-weight: 600;
  color: var(--text-primary);
}

.valuation-meta {
  font-size: 0.78em;
  color: var(--text-tertiary);
}

.valuation-placeholder {
  font-size: 0.9em;
  color: var(--text-tertiary);
  padding: 6px 0;
}

.valuation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 12px;
}

.valuation-item {
  text-align: center;
}

.valuation-label {
  display: block;
  font-size: 0.8em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.valuation-value {
  font-size: 1.05em;
  font-weight: 600;
  color: var(--text-primary);
}

.percentile-bar {
  position: relative;
  height: 8px;
  margin: 16px 4px 8px;
  border-radius: 4px;
  background: var(--border-subtle);
}

.percentile-tick {
  position: absolute;
  top: -3px;
  width: 1px;
  height: 14px;
  background: var(--text-tertiary);
  opacity: 0.5;
}

.percentile-pointer {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  border-radius: 50%;
  background: var(--color-primary, #1677ff);
  transform: translateY(-50%);
}

.valuation-note {
  font-size: 0.78em;
  color: var(--text-tertiary);
}
</style>
