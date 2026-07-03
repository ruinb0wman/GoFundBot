<template>
  <div class="positions-container">
    <div class="positions-header">
      <h2><LucideIcon name="Briefcase" :size="22" /> {{ t('fund.position.title') }}</h2>
      <p>{{ t('fund.position.desc') }}</p>
    </div>

    <form class="position-form" @submit.prevent="addPosition">
      <div class="field">
        <label>{{ t('fund.position.code') }}</label>
        <input
          v-model.trim="form.code"
          :placeholder="t('fund.position.codePlaceholder')"
          maxlength="6"
          @blur="handleCodeBlur"
          required
        />
      </div>

      <div class="field">
        <label>{{ t('fund.position.name') }}</label>
        <input v-model.trim="form.name" :placeholder="t('fund.position.nameHint')" required />
      </div>

      <div class="field">
        <label>{{ t('fund.position.purchaseDate') }}</label>
        <input v-model="form.purchaseDate" type="date" :max="today" @change="handleDateChange" required />
      </div>

      <div class="field">
        <label>{{ t('fund.position.purchaseDateHint') }}</label>
        <input v-model="form.purchaseTime" type="time" @change="handleDateChange" required />
      </div>

      <div class="field">
        <label>{{ t('fund.position.shares') }}</label>
        <input v-model.number="form.shares" type="number" min="0" step="0.01" :placeholder="t('fund.position.shares')" required />
      </div>

      <div class="field">
        <label>{{ t('fund.position.costNav') }}</label>
        <input v-model.number="form.cost" type="number" min="0" step="0.0001" :placeholder="t('fund.position.nameHint')" required />
      </div>

      <button type="submit" :disabled="isAutoFilling">{{ isAutoFilling ? t('fund.position.processing') : t('fund.position.add') }}</button>
    </form>

    <p class="tips" v-if="helperText">{{ helperText }}</p>

    <div class="operation-panel" v-if="positions.length">
      <h3><LucideIcon name="Repeat" :size="18" /> {{ t('fund.position.changeTitle') }}</h3>
      <p class="operation-tip">{{ t('fund.position.changeHint') }}</p>
      <form class="operation-form" @submit.prevent="applyOperation">
        <div class="field">
          <label>{{ t('fund.position.operationType') }}</label>
          <select v-model="operationForm.type" @change="handleOperationTypeChange">
            <option value="add">{{ t('fund.position.increase') }}</option>
            <option value="reduce">{{ t('fund.position.decrease') }}</option>
            <option value="convert">{{ t('fund.position.switch') }}</option>
          </select>
        </div>

        <div class="field">
          <label>{{ t('fund.position.originalFund') }}</label>
          <select v-model="operationForm.sourceId" required>
            <option value="" disabled>{{ t('fund.position.selectFund') }}</option>
            <option v-for="item in positions" :key="item.id" :value="item.id">
              {{ item.name }} ({{ item.code }})
            </option>
          </select>
        </div>

        <div class="field" v-if="operationForm.type === 'convert'">
          <label>{{ t('fund.position.targetCode') }}</label>
          <input
            v-model.trim="operationForm.targetCode"
            maxlength="6"
            :placeholder="t('fund.position.targetCodePlaceholder')"
            @blur="loadTargetFundName"
            required
          />
        </div>

        <div class="field" v-if="operationForm.type === 'convert'">
          <label>{{ t('fund.position.targetName') }}</label>
          <input v-model.trim="operationForm.targetName" placeholder="自动填充，可手动修改" required />
        </div>

        <div class="field">
          <label>{{ t('fund.position.amount') }}</label>
          <input v-model.number="operationForm.amount" type="number" min="0.01" step="0.01" :placeholder="t('fund.position.amountPlaceholder')" required />
        </div>

        <div class="field">
          <label>{{ t('fund.position.operationDate') }}</label>
          <input v-model="operationForm.date" type="date" :max="today" required />
        </div>

        <button type="submit" :disabled="operationLoading">{{ operationLoading ? t('fund.position.processing') : t('fund.position.confirmChange') }}</button>
      </form>
      <p class="tips" v-if="operationText">{{ operationText }}</p>
    </div>

    <div class="summary" v-if="positions.length">
      <div>{{ t('fund.position.totalCost') }} ¥{{ formatNumber(totalCost, 2) }}</div>
      <div>{{ t('fund.position.totalMarket') }} ¥{{ formatNumber(totalMarket, 2) }}</div>
      <div :class="totalProfit >= 0 ? 'up' : 'down'">{{ t('fund.position.totalProfit') }} {{ formatSigned(totalProfit) }}</div>
      <div :class="totalRate >= 0 ? 'up' : 'down'">{{ t('fund.position.totalRate') }} {{ formatSigned(totalRate) }}%</div>
      <div>{{ t('fund.position.lastRefresh') }} {{ lastRefreshTime || '--' }}</div>
    </div>

    <div class="calendar-pnl" v-if="positions.length">
      <div class="pnl-card" :class="calendarPnl.day >= 0 ? 'up-bg' : 'down-bg'">
        <div class="label">{{ t('fund.position.todayProfit') }}</div>
        <div class="value">{{ formatSigned(calendarPnl.day) }}</div>
      </div>
      <div class="pnl-card" :class="calendarPnl.month >= 0 ? 'up-bg' : 'down-bg'">
        <div class="label">{{ t('fund.position.monthProfit') }}</div>
        <div class="value">{{ formatSigned(calendarPnl.month) }}</div>
      </div>
      <div class="pnl-card" :class="calendarPnl.year >= 0 ? 'up-bg' : 'down-bg'">
        <div class="label">{{ t('fund.position.yearProfit') }}</div>
        <div class="value">{{ formatSigned(calendarPnl.year) }}</div>
      </div>
    </div>

    <div class="charts" v-if="positions.length">
      <div class="chart-card">
        <h3><LucideIcon name="BarChart3" :size="18" /> {{ t('fund.position.profitChart') }}</h3>
        <div ref="pnlBarChartEl" class="chart-el"></div>
      </div>
      <div class="chart-card">
        <h3><LucideIcon name="TrendingUp" :size="18" /> {{ t('fund.position.returnChart') }}</h3>
        <div ref="returnTrendChartEl" class="chart-el"></div>
      </div>
    </div>

    <div v-if="positions.length" class="positions-table-wrap">
      <table class="positions-table">
        <thead>
          <tr>
            <th>{{ t('common.code') }}</th>
            <th>{{ t('common.name') }}</th>
            <th>{{ t('fund.position.purchaseDate') }}</th>
            <th>{{ t('fund.position.purchaseTime') }}</th>
            <th>{{ t('fund.position.shares') }}</th>
            <th>{{ t('fund.position.costNav') }}</th>
            <th>{{ t('fund.position.realtimeVal') }}</th>
            <th>{{ t('fund.position.valTime') }}</th>
            <th>{{ t('fund.position.costPrice') }}</th>
            <th>{{ t('fund.realtime.currentMarket') }}</th>
            <th>{{ t('fund.realtime.profitLoss') }}</th>
            <th>{{ t('fund.realtime.returnRate') }}</th>
            <th>{{ t('common.action') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in positions" :key="item.id">
            <td>{{ item.code }}</td>
            <td>{{ item.name }}</td>
            <td>{{ item.purchaseDate || '-' }}</td>
            <td>{{ item.purchaseTime || '-' }}</td>
            <td>{{ formatNumber(item.shares, 2) }}</td>
            <td>{{ formatNumber(item.cost, 4) }}</td>
            <td>{{ formatNumber(currentNav(item), 4) }}</td>
            <td>{{ quoteTime(item) }}</td>
            <td>{{ formatNumber(costAmount(item), 2) }}</td>
            <td>{{ formatNumber(marketAmount(item), 2) }}</td>
            <td :class="profit(item) >= 0 ? 'up' : 'down'">{{ formatSigned(profit(item)) }}</td>
            <td :class="profitRate(item) >= 0 ? 'up' : 'down'">{{ formatSigned(profitRate(item)) }}%</td>
            <td>
              <BButton type="danger" size="small" @click="removePosition(item.id)">{{ t('common.delete') }}</BButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="empty">{{ t('fund.realtime.noPosition') }}</div>
  </div>
</template>

<script setup>
import BButton from './BButton.vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { useMyPositions } from '../composables/useMyPositions'

const {
  today, positions, form, operationForm,
  helperText, isAutoFilling, operationText, operationLoading,
  pnlBarChartEl, returnTrendChartEl,
  lastRefreshTime, totalCost, totalMarket, totalProfit, totalRate, calendarPnl,
  currentNav, quoteTime, costAmount, marketAmount, profit, profitRate,
  formatNumber, formatSigned,
  handleCodeBlur, handleDateChange, addPosition, removePosition,
  handleOperationTypeChange, loadTargetFundName, applyOperation
} = useMyPositions()
</script>

<style scoped>
.positions-container { background: var(--bg-card); border-radius: 12px; padding: 16px; box-shadow: var(--shadow-md); }
.positions-header { margin-bottom: 16px; }
.positions-header h2 { margin: 0 0 6px; }
.positions-header p { margin: 0; color: var(--text-secondary); }
.position-form { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 10px; margin-bottom: 10px; align-items: end; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; color: var(--text-secondary); }
.position-form input, .position-form button { border: 1px solid var(--border-default); border-radius: 8px; padding: 8px 10px; font-size: 14px; }
.position-form button { background: var(--color-primary); color: var(--text-inverse); border: none; cursor: pointer; height: 38px; }
.position-form button:disabled { opacity: .6; cursor: not-allowed; }
.tips { margin: 6px 0 12px; color: var(--text-secondary); font-size: 13px; }
.operation-panel { border: 1px dashed var(--border-default); border-radius: 10px; padding: 12px; margin-bottom: 14px; background: var(--bg-subtle); }
.operation-panel h3 { margin: 0 0 6px; font-size: 15px; }
.operation-tip { margin: 0 0 10px; color: var(--text-secondary); font-size: 13px; }
.operation-form { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 10px; align-items: end; }
.operation-form select, .operation-form input, .operation-form button { border: 1px solid var(--border-default); border-radius: 8px; padding: 8px 10px; font-size: 14px; background: var(--bg-card); color: var(--text-primary); }
.operation-form button { background: var(--color-primary); color: var(--text-inverse); border: none; cursor: pointer; height: 38px; }
.operation-form button:disabled { opacity: .6; cursor: not-allowed; }
.summary { margin: 8px 0 12px; display: flex; flex-wrap: wrap; gap: 12px; font-weight: 600; }
.up { color: var(--color-success); }
.down { color: var(--color-danger); }
.calendar-pnl { display: grid; grid-template-columns: repeat(3, minmax(140px, 1fr)); gap: 12px; margin-bottom: 14px; }
.pnl-card { border-radius: 10px; padding: 10px 12px; border: 1px solid var(--border-default); }
.pnl-card .label { font-size: 12px; color: var(--text-secondary); }
.pnl-card .value { font-size: 18px; font-weight: 700; margin-top: 4px; color: var(--text-primary); }
.up-bg { background: var(--color-success-bg); }
.down-bg { background: var(--color-danger-bg); }
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.chart-card { border: 1px solid var(--border-subtle); border-radius: 10px; padding: 10px; background: var(--bg-card); }
.chart-card h3 { margin: 0 0 8px; font-size: 15px; color: var(--text-primary); }
.chart-el { height: 300px; width: 100%; }
.positions-table-wrap { overflow: auto; }
.positions-table { width: 100%; border-collapse: collapse; min-width: 1320px; }
.positions-table th, .positions-table td { border-bottom: 1px solid var(--border-subtle); padding: 10px; text-align: left; font-size: 13px; }
.positions-table th { color: var(--text-secondary); }
.positions-table td { color: var(--text-primary); }
.empty { padding: 18px; text-align: center; color: var(--text-tertiary); background: var(--bg-subtle); border-radius: 8px; }
@media (max-width: 1200px) {
  .position-form { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .operation-form { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .charts { grid-template-columns: 1fr; }
  .calendar-pnl { grid-template-columns: 1fr; }
}
</style>
