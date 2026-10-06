<template>
  <div class="result-panel">
    <div class="summary-grid">
      <div class="summary-card">
        <div class="card-label">{{ '累计投入' }}</div>
        <div class="card-value">{{ formatMoney(summary.total_invested) }}</div>
      </div>
      <div class="summary-card highlight">
        <div class="card-label">{{ '最终市值' }}</div>
        <div class="card-value">{{ formatMoney(summary.final_value) }}</div>
      </div>
      <div class="summary-card" :class="getReturnClass(summary.return_rate)">
        <div class="card-label">{{ '收益率' }}</div>
        <div class="card-value">{{ formatReturn(summary.return_rate) }}%</div>
      </div>
      <div class="summary-card">
        <div class="card-label">{{ '时间加权年化' }}</div>
        <div class="card-value" :class="getReturnClass(summary.annual_return_twr)">
          {{ formatReturn(summary.annual_return_twr) }}%
        </div>
      </div>
      <div class="summary-card negative">
        <div class="card-label">{{ '最大回撤' }}</div>
        <div class="card-value">{{ summary.max_drawdown }}%</div>
      </div>
      <div class="summary-card">
        <div class="card-label">{{ '夏普比率' }}</div>
        <div class="card-value">{{ summary.sharpe_ratio }}</div>
      </div>
      <div class="summary-card">
        <div class="card-label">{{ '再平衡 / 买入' }}</div>
        <div class="card-value">{{ summary.rebalance_count }} / {{ summary.buy_count }}</div>
      </div>
    </div>

    <BacktestChart :result="result" />

    <div class="range-hint">
      {{ `实际回测区间 ${result.effective_start} ~ ${result.effective_end}（各标的共同可用区间）` }}
    </div>

    <table class="asset-table">
      <thead>
        <tr>
          <th>{{ '标的' }}</th>
          <th>{{ '目标权重' }}</th>
          <th>{{ '期末权重' }}</th>
          <th>{{ '累计投入' }}</th>
          <th>{{ '期末市值' }}</th>
          <th>{{ '收益率' }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="asset in result.assets" :key="asset.code + asset.name">
          <td>
            <span class="asset-kind" :class="asset.kind">{{ asset.kind === 'cash' ? '现金' : '基金' }}</span>
            {{ asset.name || asset.code }}
          </td>
          <td>{{ asset.targetWeight }}%</td>
          <td>{{ asset.finalWeight }}%</td>
          <td>{{ formatMoney(asset.contributed) }}</td>
          <td>{{ formatMoney(asset.finalValue) }}</td>
          <td :class="getReturnClass(asset.return_rate)">{{ formatReturn(asset.return_rate) }}%</td>
        </tr>
      </tbody>
    </table>

    <div v-if="result.excluded.length" class="excluded-note">
      {{ '未纳入回测：' + result.excluded.map((e) => `${e.code || '现金'}（${e.reason}）`).join('；') }}
    </div>
    <div class="result-note">{{ result.note }}</div>

    <div class="detail-header" @click="showDetail = !showDetail">
      <h4><LucideIcon name="ClipboardList" :size="18" /> {{ '逐日明细' }}</h4>
      <LucideIcon :name="showDetail ? 'ChevronDown' : 'ChevronRight'" :size="16" />
    </div>
    <div v-if="showDetail" class="detail-table-wrapper">
      <table class="detail-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>累计投入</th>
            <th>组合市值</th>
            <th>收益率</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(record, index) in paginatedTimeline" :key="index" :class="{ sold: record.status === 'sold' }">
            <td>{{ record.date }}</td>
            <td>{{ formatMoney(record.invested) }}</td>
            <td>{{ formatMoney(record.value) }}</td>
            <td :class="getReturnClass(record.return_rate)">{{ record.return_rate }}%</td>
            <td>{{ record.status === 'sold' ? '已清仓' : '持有' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="totalPages > 1" class="pagination">
        <BButton plain :disabled="currentPage === 1" @click="currentPage--">{{ '上一页' }}</BButton>
        <span>{{ `第 ${currentPage} / ${totalPages} 页` }}</span>
        <BButton plain :disabled="currentPage === totalPages" @click="currentPage++">{{ '下一页' }}</BButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Decimal from 'decimal.js'
import { BButton, LucideIcon } from '@gofund/ui'
import BacktestChart from './BacktestChart.vue'
import { returnClass as getReturnClass } from '../../utils/number'
import type { PortfolioBacktestResult } from '../../services/backtest/backtestTypes'

const props = defineProps<{ result: PortfolioBacktestResult }>()

const summary = computed(() => props.result.summary)
const showDetail = ref(false)
const currentPage = ref(1)
const pageSize = 50

const paginatedTimeline = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return props.result.timeline.slice(start, start + pageSize)
})
const totalPages = computed(() => Math.ceil(props.result.timeline.length / pageSize))

function formatMoney(value: unknown): string {
  if (value == null) return '0.00'
  return new Decimal(value as number).toFixed(2)
}

function formatReturn(value: unknown): string {
  if (value == null) return '0.00'
  const num = Number(value)
  return (num >= 0 ? '+' : '') + new Decimal(num).toFixed(2)
}
</script>

<style scoped>
.result-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}

.summary-card {
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-card);
}

.summary-card.highlight {
  border-color: var(--color-primary);
}

.card-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.card-value {
  margin-top: 4px;
  font-size: 16px;
  font-weight: 600;
}

.range-hint,
.result-note,
.excluded-note {
  font-size: 12px;
  color: var(--text-secondary);
}

.asset-table,
.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.asset-table th,
.asset-table td,
.detail-table th,
.detail-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-default);
  text-align: right;
}

.asset-table th:first-child,
.asset-table td:first-child,
.detail-table th:first-child,
.detail-table td:first-child {
  text-align: left;
}

.asset-kind {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-hover);
}

.asset-kind.cash {
  color: var(--color-warning);
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  font-size: 13px;
}

.detail-header h4 {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.detail-table-wrapper {
  max-height: 320px;
  overflow: auto;
}

.detail-table tr.sold {
  background: rgba(255, 77, 79, 0.08);
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 12px;
}
</style>
