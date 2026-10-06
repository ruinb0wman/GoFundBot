<template>
  <div class="portfolio-backtest">
    <div class="backtest-header">
      <h3><LucideIcon name="PieChart" :size="20" /> {{ '组合回测' }}</h3>
      <p class="header-desc">{{ '多资产按目标权重回测，支持定期/阈值再平衡与定期注水' }}</p>
    </div>

    <!-- 资产配置 -->
    <section class="asset-section">
      <div class="section-head">
        <span class="section-title"><LucideIcon name="Wallet" :size="16" /> {{ '资产配置' }}</span>
        <span class="weight-total" :class="{ warn: weightWarning }">
          {{ '权重合计' }} {{ totalWeight }}%（自动归一化）
        </span>
      </div>

      <div class="asset-list">
        <div v-for="(asset, index) in assets" :key="asset.id" class="asset-row">
          <span class="asset-kind" :class="asset.kind">{{ asset.kind === 'cash' ? '现金' : '基金' }}</span>

          <template v-if="asset.kind === 'fund'">
            <input v-model="asset.code" class="text-input code-input" placeholder="6位代码" maxlength="6" />
            <input v-model="asset.name" class="text-input name-input" placeholder="名称（可选）" />
          </template>
          <template v-else>
            <span class="cash-name">{{ asset.name }}</span>
            <BInputNumber v-model="asset.annualRate" :min="0" :max="20" :step="0.1" :controls="false">
              <template #prefix>年化</template>
              <template #suffix>%</template>
            </BInputNumber>
          </template>

          <div class="weight-cell">
            <BInputNumber v-model="asset.weight" :min="0" :max="100" :step="5" :controls="false">
              <template #prefix>权重</template>
              <template #suffix>%</template>
            </BInputNumber>
            <span class="weight-normalized">→ {{ normalizedWeights[index].toFixed(1) }}%</span>
          </div>

          <BButton circle size="small" type="danger" :title="'删除'" @click="removeAsset(asset.id)">
            <LucideIcon name="Trash2" :size="13" />
          </BButton>
        </div>
      </div>

      <div v-if="weightWarning" class="asset-warning">{{ weightWarning }}</div>

      <div class="asset-actions">
        <BButton size="small" plain @click="showSearch = !showSearch">
          <LucideIcon name="Plus" :size="14" /> {{ '添加基金' }}
        </BButton>
        <BButton size="small" plain @click="addCash">
          <LucideIcon name="Plus" :size="14" /> {{ '添加现金腿' }}
        </BButton>
      </div>

      <div v-if="showSearch" class="asset-search">
        <FundSearch compact @fund-selected="handleFundSelected" />
      </div>
    </section>

    <!-- 回测参数 -->
    <section class="param-section">
      <div class="param-row">
        <div class="param-item">
          <label>{{ '开始日期' }}</label>
          <BDatePicker v-model="params.startDate" :max="params.endDate" />
        </div>
        <div class="param-item">
          <label>{{ '结束日期' }}</label>
          <BDatePicker v-model="params.endDate" :min="params.startDate" :max="today" />
        </div>
      </div>

      <div class="param-row">
        <div class="param-item">
          <label>{{ '期初投入' }}</label>
          <BInputNumber v-model="params.initialAmount" :min="0" :step="10000" :controls="false">
            <template #suffix>元</template>
          </BInputNumber>
        </div>
        <div class="param-item">
          <label>{{ '定投注水' }}</label>
          <div class="inline-param">
            <BInputNumber v-model="params.contributionAmount" :min="0" :step="1000" :controls="false" placeholder="0">
              <template #suffix>元</template>
            </BInputNumber>
            <select v-model="params.contributionPeriod">
              <option value="none">{{ '不注水' }}</option>
              <option value="monthly">{{ '每月' }}</option>
              <option value="quarterly">{{ '每季' }}</option>
              <option value="yearly">{{ '每年' }}</option>
            </select>
          </div>
        </div>
      </div>

      <div class="param-row">
        <div class="param-item">
          <label>{{ '再平衡频率' }}</label>
          <select v-model="params.rebalanceFrequency">
            <option value="none">{{ '不再平衡' }}</option>
            <option value="monthly">{{ '每月' }}</option>
            <option value="quarterly">{{ '每季' }}</option>
            <option value="yearly">{{ '每年' }}</option>
          </select>
        </div>
        <div class="param-item">
          <label>{{ '偏离阈值（可选）' }}</label>
          <BInputNumber v-model="params.rebalanceThreshold" :min="0" :max="50" :step="1" :controls="false" placeholder="不启用">
            <template #suffix>%</template>
          </BInputNumber>
        </div>
        <div class="param-item">
          <label>{{ '手续费率' }}</label>
          <BInputNumber v-model="params.feeRate" :min="0" :max="5" :step="0.05" :controls="false">
            <template #suffix>%</template>
          </BInputNumber>
        </div>
      </div>

      <div class="param-hint">
        {{ '注水默认补最缺的腿；手续费按买卖双向扣减，未区分申赎费/印花税。' }}
      </div>

      <div class="param-actions">
        <BButton type="primary" :disabled="loading" @click="run">
          {{ loading ? '计算中...' : '开始组合回测' }}
        </BButton>
      </div>
    </section>

    <div v-if="error" class="error-message">{{ error }}</div>

    <!-- 结果 -->
    <div v-if="result" class="result-section">
      <div class="summary-grid">
        <div class="summary-card">
          <div class="card-label">{{ '累计投入' }}</div>
          <div class="card-value">{{ formatMoney(result.summary.total_invested) }}</div>
        </div>
        <div class="summary-card highlight">
          <div class="card-label">{{ '最终市值' }}</div>
          <div class="card-value">{{ formatMoney(result.summary.final_value) }}</div>
        </div>
        <div class="summary-card" :class="getReturnClass(result.summary.return_rate)">
          <div class="card-label">{{ '收益率' }}</div>
          <div class="card-value">{{ formatReturn(result.summary.return_rate) }}%</div>
        </div>
        <div class="summary-card">
          <div class="card-label">{{ '时间加权年化' }}</div>
          <div class="card-value" :class="getReturnClass(result.summary.annual_return_twr)">
            {{ formatReturn(result.summary.annual_return_twr) }}%
          </div>
        </div>
        <div class="summary-card negative">
          <div class="card-label">{{ '最大回撤' }}</div>
          <div class="card-value">{{ result.summary.max_drawdown }}%</div>
        </div>
        <div class="summary-card">
          <div class="card-label">{{ '夏普比率' }}</div>
          <div class="card-value">{{ result.summary.sharpe_ratio }}</div>
        </div>
        <div class="summary-card">
          <div class="card-label">{{ '再平衡 / 注水' }}</div>
          <div class="card-value">{{ result.summary.rebalance_count }} / {{ result.summary.contribution_count }}</div>
        </div>
      </div>

      <div class="range-hint">
        {{ `实际回测区间 ${result.effective_start} ~ ${result.effective_end}（各资产共同可用区间）` }}
      </div>

      <div ref="chartEl" class="chart-container"></div>

      <table class="asset-table">
        <thead>
          <tr>
            <th>{{ '资产' }}</th>
            <th>{{ '目标权重' }}</th>
            <th>{{ '期末权重' }}</th>
            <th>{{ '累计投入' }}</th>
            <th>{{ '期末市值' }}</th>
            <th>{{ '收益率' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="asset in result.assets" :key="asset.code">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { BButton, BInputNumber, BDatePicker, LucideIcon } from '@gofund/ui'
import FundSearch from './FundSearch.vue'
import { usePortfolioBacktest } from '../composables/usePortfolioBacktest'

defineOptions({ name: 'PortfolioBacktest' })

const showSearch = ref(false)

const {
  chartEl,
  result,
  loading,
  error,
  assets,
  params,
  totalWeight,
  normalizedWeights,
  weightWarning,
  today,
  addFund,
  addCash,
  removeAsset,
  run,
  init,
  formatMoney,
  formatReturn,
  getReturnClass,
} = usePortfolioBacktest()

function handleFundSelected(fund: Record<string, unknown>) {
  addFund(fund)
  showSearch.value = false
}

onMounted(init)
</script>

<style src="./PortfolioBacktest.css" scoped></style>
