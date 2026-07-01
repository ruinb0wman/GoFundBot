<template>
  <div class="same-type-container">
    <div class="section-header">
      <h3><LucideIcon name="TrendingUp" :size="20" /> {{ t('fund.sameType.title') }}</h3>
      <div class="period-tabs">
        <button
          v-for="(period, index) in periods"
          :key="index"
          :class="['period-tab', { active: activePeriod === index }]"
          @click.stop="activePeriod = index"
        >
          {{ period }}
        </button>
      </div>
    </div>
    <div class="fund-list" v-if="currentFunds.length > 0">
      <div
        v-for="(fund, index) in currentFunds"
        :key="fund.code"
        class="fund-item"
        @click.stop="onFundClick(fund.code)"
      >
        <div class="rank" :class="getRankClass(index)">{{ Number(index) + 1 }}</div>
        <div class="fund-info">
          <div class="fund-name" :title="fund.name">{{ fund.name }}</div>
          <div class="fund-code">{{ fund.code }}</div>
        </div>
        <div class="return-rate" :class="getReturnClass(fund.return_rate)">
          {{ formatReturn(fund.return_rate) }}
        </div>
      </div>
    </div>
    <div v-else class="empty-state">
      <span>{{ t('common.noData') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  sameTypeFunds?: any[]
  isExpanded?: boolean
}>(), {
  sameTypeFunds: () => [],
  isExpanded: false,
})

const emit = defineEmits<{
  'fund-select': [code: string]
}>()

const activePeriod = ref(0)
const periods = ['主题1', '主题2', '主题3', '主题4', '主题5']

const currentFunds = computed(() => {
  if (!props.sameTypeFunds || !Array.isArray(props.sameTypeFunds)) return []
  return props.sameTypeFunds[activePeriod.value] || []
})

function getRankClass(index: string | number): string {
  const i = Number(index)
  if (i === 0) return 'rank-1'
  if (i === 1) return 'rank-2'
  if (i === 2) return 'rank-3'
  return ''
}

function getReturnClass(rate: unknown): string {
  return parseFloat(String(rate)) >= 0 ? 'positive' : 'negative'
}

function formatReturn(rate: unknown): string {
  const value = parseFloat(String(rate))
  if (isNaN(value)) return '--'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function onFundClick(code: string): void {
  emit('fund-select', code)
}
</script>

<style scoped>
.same-type-container { padding: 16px; height: 100%; display: flex; flex-direction: column; --header-padding-right: v-bind(isExpanded ? '40px' : '0'); }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; padding-right: var(--header-padding-right, 0); }
.section-header h3 { font-size: 16px; font-weight: 600; color: var(--text-primary); margin: 0; }
.period-tabs { display: flex; gap: 4px; }
.period-tab { padding: 4px 8px; font-size: 11px; border: 1px solid var(--border-default); border-radius: 4px; background: var(--bg-card); color: var(--text-secondary); cursor: pointer; transition: all 0.2s; }
.period-tab:hover { border-color: var(--color-primary); color: var(--color-primary); }
.period-tab.active { background: var(--bg-gradient); color: white; border-color: transparent; }
.fund-list { flex: 1; overflow-y: auto; }
.fund-item { display: flex; align-items: center; padding: 10px 8px; border-radius: 8px; cursor: pointer; transition: all 0.2s; margin-bottom: 4px; }
.fund-item:hover { background: var(--bg-page); }
.rank { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: var(--text-tertiary); background: var(--bg-subtle); margin-right: 10px; flex-shrink: 0; }
.rank-1 { background: linear-gradient(135deg, #ffd700 0%, #ffb800 100%); color: white; }
.rank-2 { background: linear-gradient(135deg, #c0c0c0 0%, #a8a8a8 100%); color: white; }
.rank-3 { background: linear-gradient(135deg, #cd7f32 0%, #b8722b 100%); color: white; }
.fund-info { flex: 1; min-width: 0; margin-right: 8px; }
.fund-name { font-size: 13px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fund-code { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.return-rate { font-size: 14px; font-weight: 600; flex-shrink: 0; }
.return-rate.positive { color: var(--color-danger); }
.return-rate.negative { color: var(--color-success); }
.empty-state { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); font-size: 14px; }
.fund-list::-webkit-scrollbar { width: 4px; }
.fund-list::-webkit-scrollbar-track { background: var(--bg-subtle); border-radius: 2px; }
.fund-list::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 2px; }
.fund-list::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }
</style>
