<template>
  <div class="portfolio-card">
    <div class="card-header">
      <h3><LucideIcon name="TrendingUp" :size="20" /> 持仓明细</h3>
    </div>
    <div class="card-body">
      <div class="portfolio-content">
        <div v-if="hasStockData" class="stock-list">
          <div class="portfolio-header">
            <span class="col-rank">排名</span>
            <span class="col-code">代码</span>
            <span class="col-name">名称</span>
            <span v-if="hasRatioData" class="col-ratio">占比</span>
            <span class="col-industry">行业</span>
          </div>
          <div
            v-for="(stock, index) in stockList"
            :key="stock.code || index"
            class="portfolio-item stock-clickable"
            @click.stop="$emit('stock-click', stock)"
            title="点击查看个股详情"
          >
            <span class="col-rank">{{ index + 1 }}</span>
            <span class="col-code">{{ stock.code }}</span>
            <span class="col-name">{{ stock.name }}</span>
            <span v-if="hasRatioData" class="col-ratio">{{ formatRatio(stock.ratio) }}</span>
            <span class="col-industry" :title="stock.industryText">{{ stock.industryText }}</span>
          </div>
        </div>
        <div v-else class="no-data">
          <p>暂无股票持仓数据</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Portfolio, PortfolioHolding } from '../types'

const props = withDefaults(defineProps<{
  portfolio?: Portfolio
}>(), {
  portfolio: () => ({}),
})

defineEmits<{
  'stock-click': [stock: PortfolioHolding]
}>()

function parseHoldings(codes: unknown): PortfolioHolding[] {
  if (!codes || !Array.isArray(codes)) return []
  const displayIndustry = (item: any = {}) => item.industry || item.industry_name || item.industryName || item.sector || item.sector_name || '未识别'
  const normalizeRatio = (value: any): number | null => {
    const num = Number(String(value ?? '').replace('%', ''))
    return Number.isFinite(num) && num > 0 ? num : null
  }
  if (codes.length > 0 && typeof codes[0] === 'object' && codes[0] !== null) {
    return codes.map((item: any) => ({ ...item, ratio: normalizeRatio(item.ratio ?? item.position ?? item.hold_ratio), industryText: displayIndustry(item) }))
  }
  const holdings: PortfolioHolding[] = []
  for (let i = 0; i < codes.length; i += 3) {
    if (i + 2 < codes.length) {
      holdings.push({ code: String(codes[i]), name: String(codes[i + 1]), ratio: normalizeRatio(codes[i + 2]), industryText: '未识别' })
    }
  }
  return holdings
}

const stockList = computed(() => {
  const newCodes = props.portfolio?.stock_codes_new
  const oldCodes = props.portfolio?.stock_codes
  return parseHoldings(newCodes?.length ? newCodes : oldCodes)
})

const hasStockData = computed(() => stockList.value.length > 0)
const hasRatioData = computed(() => stockList.value.some(stock => Number(stock.ratio) > 0))

function formatRatio(value: number | null): string {
  return Number.isFinite(value) && (value as number) > 0 ? `${(value as number).toFixed(2)}%` : '-'
}
</script>

<style scoped>
.portfolio-card { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.card-header { background: var(--bg-gradient); padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
.card-header h3 { margin: 0; color: white; font-size: 14px; font-weight: 600; }
.card-body { padding: 10px; flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.portfolio-content { flex: 1; overflow-y: auto; padding-right: 12px; }
.portfolio-header { display: flex; padding: 8px 0; border-bottom: 2px solid var(--border-default); font-weight: 600; color: var(--text-secondary); font-size: 11px; position: sticky; top: 0; background: var(--bg-card); }
.portfolio-item { display: flex; padding: 8px 0; border-bottom: 1px solid var(--border-subtle); align-items: center; font-size: 12px; }
.stock-clickable { cursor: pointer; transition: background 0.15s, transform 0.15s; }
.stock-clickable:hover { background: var(--color-primary-bg); transform: translateX(2px); }
.col-rank { width: 40px; text-align: center; color: var(--text-tertiary); font-weight: 500; margin: 0 8px; flex-shrink: 0; }
.portfolio-item .col-rank { width: 24px; height: 24px; line-height: 24px; background: var(--bg-subtle); border-radius: 50%; font-size: 11px; display: inline-block; text-align: center; }
.portfolio-item:nth-child(2) .col-rank { background: #ffd700; color: #fff; }
.portfolio-item:nth-child(3) .col-rank { background: #c0c0c0; color: #fff; }
.portfolio-item:nth-child(4) .col-rank { background: #cd7f32; color: #fff; }
.col-code { width: 68px; color: var(--color-primary); font-family: monospace; font-size: 11px; flex-shrink: 0; }
.col-name { flex: 1; min-width: 88px; color: var(--text-primary); font-weight: 500; padding-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-ratio { width: 56px; color: var(--text-secondary); font-size: 11px; text-align: right; padding-right: 10px; flex-shrink: 0; }
.col-industry { width: 76px; text-align: left; color: var(--text-tertiary); font-size: 11px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.no-data { display: flex; align-items: center; justify-content: center; height: 100%; }
</style>
