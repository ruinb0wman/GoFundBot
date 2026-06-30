<template>
  <div class="positions-container">
    <div class="positions-header">
      <h2><LucideIcon name="Briefcase" :size="22" /> 我的持仓</h2>
      <p>输入基金代码自动补全名称；按中国基金交易规则自动处理购买日净值；持仓按实时估值刷新盈亏。</p>
    </div>

    <form class="position-form" @submit.prevent="addPosition">
      <div class="field">
        <label>基金代码</label>
        <input
          v-model.trim="form.code"
          placeholder="如 110022"
          maxlength="6"
          @blur="handleCodeBlur"
          required
        />
      </div>

      <div class="field">
        <label>基金名称</label>
        <input v-model.trim="form.name" placeholder="自动填充，可手动修改" required />
      </div>

      <div class="field">
        <label>购买日期</label>
        <input v-model="form.purchaseDate" type="date" :max="today" @change="handleDateChange" required />
      </div>

      <div class="field">
        <label>购买时间（用于当日15:00规则）</label>
        <input v-model="form.purchaseTime" type="time" @change="handleDateChange" required />
      </div>

      <div class="field">
        <label>持有份额</label>
        <input v-model.number="form.shares" type="number" min="0" step="0.01" placeholder="持有份额" required />
      </div>

      <div class="field">
        <label>成本净值</label>
        <input v-model.number="form.cost" type="number" min="0" step="0.0001" placeholder="自动填充，可手动修改" required />
      </div>

      <button type="submit" :disabled="isAutoFilling">{{ isAutoFilling ? '处理中...' : '添加' }}</button>
    </form>

    <p class="tips" v-if="helperText">{{ helperText }}</p>

    <div class="operation-panel" v-if="positions.length">
      <h3><LucideIcon name="Repeat" :size="18" /> 持仓变更（加仓 / 减仓 / 转换）</h3>
      <p class="operation-tip">建议在晚上 21:00 后操作：基金准确净值通常在晚间更新，按金额换算份额更准确。</p>
      <form class="operation-form" @submit.prevent="applyOperation">
        <div class="field">
          <label>操作类型</label>
          <select v-model="operationForm.type" @change="handleOperationTypeChange">
            <option value="add">加仓</option>
            <option value="reduce">减仓</option>
            <option value="convert">转换</option>
          </select>
        </div>

        <div class="field">
          <label>原基金</label>
          <select v-model="operationForm.sourceId" required>
            <option value="" disabled>请选择基金</option>
            <option v-for="item in positions" :key="item.id" :value="item.id">
              {{ item.name }} ({{ item.code }})
            </option>
          </select>
        </div>

        <div class="field" v-if="operationForm.type === 'convert'">
          <label>目标基金代码</label>
          <input
            v-model.trim="operationForm.targetCode"
            maxlength="6"
            placeholder="如 001632"
            @blur="loadTargetFundName"
            required
          />
        </div>

        <div class="field" v-if="operationForm.type === 'convert'">
          <label>目标基金名称</label>
          <input v-model.trim="operationForm.targetName" placeholder="自动填充，可手动修改" required />
        </div>

        <div class="field">
          <label>金额（元）</label>
          <input v-model.number="operationForm.amount" type="number" min="0.01" step="0.01" placeholder="输入金额" required />
        </div>

        <div class="field">
          <label>操作日期</label>
          <input v-model="operationForm.date" type="date" :max="today" required />
        </div>

        <button type="submit" :disabled="operationLoading">{{ operationLoading ? '处理中...' : '确认变更' }}</button>
      </form>
      <p class="tips" v-if="operationText">{{ operationText }}</p>
    </div>

    <div class="summary" v-if="positions.length">
      <div>总成本：¥{{ formatNumber(totalCost, 2) }}</div>
      <div>总市值：¥{{ formatNumber(totalMarket, 2) }}</div>
      <div :class="totalProfit >= 0 ? 'up' : 'down'">总盈亏：{{ formatSigned(totalProfit) }}</div>
      <div :class="totalRate >= 0 ? 'up' : 'down'">总收益率：{{ formatSigned(totalRate) }}%</div>
      <div>上次刷新：{{ lastRefreshTime || '--' }}</div>
    </div>

    <div class="calendar-pnl" v-if="positions.length">
      <div class="pnl-card" :class="calendarPnl.day >= 0 ? 'up-bg' : 'down-bg'">
        <div class="label">今日盈亏</div>
        <div class="value">{{ formatSigned(calendarPnl.day) }}</div>
      </div>
      <div class="pnl-card" :class="calendarPnl.month >= 0 ? 'up-bg' : 'down-bg'">
        <div class="label">本月盈亏</div>
        <div class="value">{{ formatSigned(calendarPnl.month) }}</div>
      </div>
      <div class="pnl-card" :class="calendarPnl.year >= 0 ? 'up-bg' : 'down-bg'">
        <div class="label">本年盈亏</div>
        <div class="value">{{ formatSigned(calendarPnl.year) }}</div>
      </div>
    </div>

    <div class="charts" v-if="positions.length">
      <div class="chart-card">
        <h3><LucideIcon name="BarChart3" :size="18" /> 持仓盈亏柱状图（明细）</h3>
        <div ref="pnlBarChartEl" class="chart-el"></div>
      </div>
      <div class="chart-card">
        <h3><LucideIcon name="TrendingUp" :size="18" /> 持有收益率走势（从成本起算）</h3>
        <div ref="returnTrendChartEl" class="chart-el"></div>
      </div>
    </div>

    <div v-if="positions.length" class="positions-table-wrap">
      <table class="positions-table">
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>购买日期</th>
            <th>购买时间</th>
            <th>份额</th>
            <th>成本净值</th>
            <th>实时估值</th>
            <th>估值时间</th>
            <th>持仓成本</th>
            <th>持仓市值</th>
            <th>盈亏</th>
            <th>盈亏率</th>
            <th>操作</th>
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
              <button class="danger" @click="removePosition(item.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="empty">暂无持仓，先添加一条记录吧。</div>
  </div>
</template>

<script setup>
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
.danger { background: var(--color-danger); color: var(--text-inverse); border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
@media (max-width: 1200px) {
  .position-form { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .operation-form { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .charts { grid-template-columns: 1fr; }
  .calendar-pnl { grid-template-columns: 1fr; }
}
</style>
