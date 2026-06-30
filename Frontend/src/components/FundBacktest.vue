<template>
  <div class="fund-backtest">
    <div class="backtest-header">
      <h3><LucideIcon name="BarChart3" :size="20" /> 定投回测</h3>
      <p class="header-desc">模拟历史定投收益，验证投资策略</p>
    </div>

    <!-- 基金选择 -->
    <div class="fund-select-section">
      <div v-if="!currentFundCode" class="search-container">
        <p class="select-hint">请先选择一只基金进行回测</p>
        <FundSearch @fund-selected="handleFundSelected" />
      </div>
      <div v-else class="selected-fund-display">
        <div class="fund-info">
          <span class="label">当前回测基金:</span>
          <span class="code">{{ currentFundCode }}</span>
          <span class="name" v-if="currentFundName">{{ currentFundName }}</span>
        </div>
        <button class="btn-change" @click="changeFund">更换基金</button>
      </div>
    </div>

    <!-- 回测参数设置 (仅在已选择基金时显示) -->
    <div v-if="currentFundCode" class="backtest-content">
      <div class="backtest-params">
        <div class="param-row">
        <div class="param-item">
          <label>投资方式</label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" v-model="params.investmentType" value="monthly" />
              <span>每月定投</span>
            </label>
            <label class="radio-label">
              <input type="radio" v-model="params.investmentType" value="weekly" />
              <span>每周定投</span>
            </label>
            <label class="radio-label">
              <input type="radio" v-model="params.investmentType" value="daily" />
              <span>每日定投</span>
            </label>
            <label class="radio-label">
              <input type="radio" v-model="params.investmentType" value="lump_sum" />
              <span>一次性买入</span>
            </label>
          </div>

          <!-- 定投具体日期选择 -->
          <div v-if="params.investmentType === 'monthly'" class="sub-param">
            <label>定投日：</label>
            <select v-model="params.investmentDay">
              <option v-for="d in 28" :key="d" :value="d">每月{{ d }}号</option>
            </select>
          </div>
          <div v-if="params.investmentType === 'weekly'" class="sub-param">
            <label>定投日：</label>
            <select v-model="params.investmentDay">
              <option :value="0">周一</option>
              <option :value="1">周二</option>
              <option :value="2">周三</option>
              <option :value="3">周四</option>
              <option :value="4">周五</option>
            </select>
          </div>
        </div>
      </div>

      <div class="param-row">
        <div class="param-item">
          <label>{{ params.investmentType === 'lump_sum' ? '投资金额' : '每期金额' }}</label>
          <div class="input-with-unit">
            <input
              type="number"
              v-model.number="params.amount"
              min="0"
              step="100"
              placeholder="1000"
            />
            <span class="unit">元</span>
          </div>
        </div>

        <div class="param-item">
          <label>初始资金</label>
          <div class="input-with-unit">
            <input
              type="number"
              v-model.number="params.initialAmount"
              min="0"
              step="1000"
              placeholder="0"
            />
            <span class="unit">元</span>
          </div>
        </div>
      </div>

      <div class="param-row">
        <div class="param-item">
          <label>分红方式</label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" v-model="params.dividendMode" value="reinvest" />
              <span>红利再投资</span>
            </label>
            <label class="radio-label">
              <input type="radio" v-model="params.dividendMode" value="cash" />
              <span>现金分红</span>
            </label>
          </div>
        </div>

        <div class="param-item">
          <label>止盈后资金处理</label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" v-model="params.takeProfitAction" value="cash" />
              <span>落袋为安 (现金)</span>
            </label>
            <label class="radio-label">
              <input type="radio" v-model="params.takeProfitAction" value="monetary" />
              <span>货币理财 (年化2%)</span>
            </label>
          </div>
        </div>
      </div>

      <div class="param-row">
        <div class="param-item">
          <label>止盈率</label>
          <div class="input-with-unit">
            <input
              type="number"
              v-model.number="params.takeProfitRate"
              min="0"
              step="1"
              placeholder="可选"
            />
            <span class="unit">%</span>
          </div>
        </div>

        <div class="param-item">
          <label>止损率</label>
          <div class="input-with-unit">
            <input
              type="number"
              v-model.number="params.stopLossRate"
              min="0"
              step="1"
              placeholder="可选"
            />
            <span class="unit">%</span>
          </div>
        </div>
      </div>

      <div class="param-row">
        <div class="param-item">
          <label>手续费率</label>
          <div class="input-with-unit">
            <input
              type="number"
              v-model.number="params.feeRate"
              min="0"
              max="2"
              step="0.01"
              placeholder="0.15"
            />
            <span class="unit">%</span>
          </div>
        </div>
      </div>

      <div class="param-row">
        <div class="param-item">
          <label>开始日期</label>
          <input type="date" v-model="params.startDate" :min="minStartDate" :max="params.endDate" />
          <div v-if="minStartDate" class="date-hint">成立日: {{ minStartDate }}</div>
        </div>

        <div class="param-item">
          <label>结束日期</label>
          <input type="date" v-model="params.endDate" :min="params.startDate" :max="today" />
        </div>
      </div>

      <div class="param-actions">
        <button class="btn btn-primary" @click="runBacktest" :disabled="loading">
          <span v-if="loading">计算中...</span>
          <span v-else>开始回测</span>
        </button>
        <button class="btn btn-strategy" @click="suggestStrategy" :disabled="loading || strategyLoading">
          <span v-if="strategyLoading">生成中...</span>
          <span v-else><LucideIcon name="Wand2" :size="14" /> 智能推荐策略</span>
        </button>
        <button class="btn btn-secondary" @click="resetParams" :disabled="loading">
          重置参数
        </button>
      </div>
    </div>

    <!-- 策略推荐结果 -->
    <div v-if="strategyResult" class="strategy-section">
      <div class="section-title"><LucideIcon name="Sparkles" :size="18" /> 推荐策略</div>
      <div class="strategy-card">
        <div class="strategy-name">{{ strategyResult.recommended.name }}</div>
        <div class="strategy-desc">{{ strategyResult.recommended.description }}</div>
        <div class="strategy-reason">{{ strategyResult.recommended.reason }}</div>
        <div class="strategy-metrics">
          <div class="metric"><span class="mlabel">年化收益</span><span class="mvalue positive">{{ strategyResult.recommended.summary.annual_return }}%</span></div>
          <div class="metric"><span class="mlabel">总收益</span><span class="mvalue positive">{{ strategyResult.recommended.summary.return_rate }}%</span></div>
          <div class="metric"><span class="mlabel">最大回撤</span><span class="mvalue negative">-{{ strategyResult.recommended.summary.max_drawdown }}%</span></div>
          <div class="metric"><span class="mlabel">夏普比率</span><span class="mvalue">{{ strategyResult.recommended.summary.sharpe_ratio }}</span></div>
        </div>
        <button class="btn btn-sm" @click="applyStrategyParams">应用此策略参数</button>
      </div>
      <div class="strategy-compare" v-if="strategyResult.strategies.length > 1">
        <div class="section-subtitle">全部策略对比</div>
        <div v-for="s in strategyResult.strategies" :key="s.key" class="compare-row" :class="{ recommended: s.key === strategyResult.recommended.key }">
          <span class="sname">{{ s.name }}</span>
          <span class="sreturn">{{ s.summary.return_rate }}%</span>
          <span class="sdrawdown">{{ s.summary.max_drawdown }}%</span>
          <span class="ssharpe">{{ s.summary.sharpe_ratio }}</span>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <!-- 回测结果 -->
    <div v-if="result" class="backtest-result">
      <!-- 汇总指标 -->
      <div class="summary-section">
        <h4><LucideIcon name="TrendingUp" :size="18" /> 回测结果</h4>
        <div class="summary-grid">
          <div class="summary-card">
            <div class="card-label">总投入</div>
            <div class="card-value">{{ formatMoney(result.summary.total_invested) }}</div>
          </div>
          <div class="summary-card highlight">
            <div class="card-label">最终市值</div>
            <div class="card-value">{{ formatMoney(result.summary.final_value) }}</div>
          </div>
          <div class="summary-card" :class="getReturnClass(result.summary.total_return)">
            <div class="card-label">总收益</div>
            <div class="card-value">{{ formatReturn(result.summary.total_return) }}</div>
          </div>
          <div class="summary-card" :class="getReturnClass(result.summary.return_rate)">
            <div class="card-label">收益率</div>
            <div class="card-value">{{ result.summary.return_rate }}%</div>
          </div>
          <div class="summary-card">
            <div class="card-label">年化收益率</div>
            <div class="card-value" :class="getReturnClass(result.summary.annual_return)">
              {{ result.summary.annual_return }}%
            </div>
          </div>
          <div class="summary-card negative">
            <div class="card-label">最大回撤</div>
            <div class="card-value">{{ result.summary.max_drawdown }}%</div>
          </div>
          <div class="summary-card">
            <div class="card-label">夏普比率</div>
            <div class="card-value">{{ result.summary.sharpe_ratio }}</div>
          </div>
          <div class="summary-card">
            <div class="card-label">投资次数</div>
            <div class="card-value">{{ result.summary.investment_count }}次</div>
          </div>
          <div class="summary-card" v-if="result.summary.exit_reason">
            <div class="card-label">止盈止损</div>
            <div class="card-value" :class="result.summary.exit_reason === 'take_profit' ? 'red' : 'green'">
              {{ result.summary.exit_reason === 'take_profit' ? '止盈卖出' : '止损卖出' }}
            </div>
          </div>
        </div>
      </div>

      <!-- 收益曲线图 -->
      <div class="chart-section">
        <h4><LucideIcon name="JapaneseYen" :size="18" /> 收益曲线</h4>
        <div class="chart-tabs">
          <div
            class="tab-item"
            :class="{ active: chartType === 'value' }"
            @click="chartType = 'value'"
          >
            市值变化
          </div>
          <div
            class="tab-item"
            :class="{ active: chartType === 'return' }"
            @click="chartType = 'return'"
          >
            收益率
          </div>
        </div>
        <div ref="chartEl" class="chart-container"></div>
      </div>

      <!-- 详细数据表格（可选展开） -->
      <div class="detail-section">
        <div class="detail-header" @click="showDetail = !showDetail">
          <h4><LucideIcon name="ClipboardList" :size="18" /> 详细记录</h4>
          <span class="toggle-icon"><LucideIcon :name="showDetail ? 'ChevronDown' : 'ChevronRight'" :size="16" /></span>
        </div>
        <div v-if="showDetail" class="detail-table-wrapper">
          <table class="detail-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>净值</th>
                <th>累计投入</th>
                <th>持有份额</th>
                <th>市值</th>
                <th>收益</th>
                <th>收益率</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(record, index) in paginatedTimeline"
                :key="index"
                :class="{ 'investment-day': record.is_investment_day, 'sold-day': record.status === 'sold' }"
              >
                <td>
                  {{ record.date }}
                  <span v-if="record.is_investment_day" class="invest-badge">买入</span>
                  <span v-if="record.status === 'sold' && record.exit_reason" class="sold-badge">
                    {{ record.exit_reason === 'take_profit' ? '止盈' : '止损' }}
                  </span>
                </td>
                <td>{{ record.nav }}</td>
                <td>{{ formatMoney(record.invested) }}</td>
                <td>{{ record.shares }}</td>
                <td>{{ formatMoney(record.value) }}</td>
                <td :class="getReturnClass(record.return)">{{ formatReturn(record.return) }}</td>
                <td :class="getReturnClass(record.return_rate)">{{ record.return_rate }}%</td>
              </tr>
            </tbody>
          </table>
          <div class="pagination" v-if="totalPages > 1">
            <button @click="currentPage--" :disabled="currentPage === 1">上一页</button>
            <span>第 {{ currentPage }} / {{ totalPages }} 页</span>
            <button @click="currentPage++" :disabled="currentPage === totalPages">下一页</button>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useFundBacktest } from '../composables/useFundBacktest'
import FundSearch from './FundSearch.vue'

const props = defineProps({
  fundCode: {
    type: String,
    default: ''
  }
})

const {
  chartEl,
  loading,
  error,
  result,
  currentFundCode,
  currentFundName,
  minStartDate,
  strategyResult,
  strategyLoading,
  showDetail,
  chartType,
  currentPage,
  params,
  today,
  paginatedTimeline,
  totalPages,
  handleFundSelected,
  changeFund,
  runBacktest,
  resetParams,
  suggestStrategy,
  applyStrategyParams,
  formatMoney,
  formatReturn,
  getReturnClass
} = useFundBacktest(props)
</script>

<style src="./FundBacktest.css" scoped></style>
