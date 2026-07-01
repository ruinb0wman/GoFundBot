<template>
  <div class="research-dashboard">
    <div class="research-header">
      <div>
        <h2>{{ t('research.title') }}</h2>
        <p>{{ t('research.desc') }}</p>
      </div>
      <div class="header-actions">
        <span v-if="updatedAt" class="updated-time">更新 {{ formatDateTime(updatedAt) }}</span>
        <button class="refresh-btn" :disabled="loading" @click="refreshDashboard">
          {{ loading ? t('research.refreshing') : t('common.refresh') }}
        </button>
      </div>
    </div>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="loading" class="state-card">{{ t('research.loading') }}</div>
    <div v-else-if="error" class="state-card error">{{ error }}</div>
    <template v-else>
      <section v-show="activeTab === 'market'" class="tab-section">
        <div class="metric-grid">
          <div class="metric-card">
            <span class="metric-label">{{ t('research.totalFunds') }}</span>
            <strong>{{ summary.total_funds || 0 }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">{{ t('research.riskCoverage') }}</span>
            <strong>{{ formatPercent(summary.risk_ready_rate) }}</strong>
            <small>{{ summary.risk_ready || 0 }} 只</small>
          </div>
          <div class="metric-card">
            <span class="metric-label">{{ t('research.passRate4433') }}</span>
            <strong>{{ formatPercent(summary.pass_4433_rate) }}</strong>
            <small>{{ summary.pass_4433 || 0 }} 只</small>
          </div>
          <div class="metric-card">
            <span class="metric-label">{{ t('research.positiveReturn1y') }}</span>
            <strong>{{ formatPercent(summary.positive_1y_rate) }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">{{ t('research.medianReturn1y') }}</span>
            <strong :class="returnClass(summary.return_1y_median)">
              {{ formatPercent(summary.return_1y_median) }}
            </strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">{{ t('research.medianReturn3m') }}</span>
            <strong :class="returnClass(summary.return_3m_median)">
              {{ formatPercent(summary.return_3m_median) }}
            </strong>
          </div>
        </div>

        <div class="split-grid">
          <div class="panel">
            <div class="panel-title">基金类型分布</div>
            <table class="data-table">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>数量</th>
                  <th>占比</th>
                  <th>1年中位</th>
                  <th>4433</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in typeStats" :key="item.fund_type">
                  <td>{{ item.fund_type }}</td>
                  <td>{{ item.count }}</td>
                  <td>{{ formatPercent(item.ratio) }}</td>
                  <td :class="returnClass(item.return_1y_median)">{{ formatPercent(item.return_1y_median) }}</td>
                  <td>{{ item.pass_4433 }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="panel">
            <div class="panel-title">投研分组概览</div>
            <div class="group-list">
              <div v-for="item in groupStats" :key="item.key" class="group-row">
                <div>
                  <strong>{{ item.name }}</strong>
                  <span>{{ item.count }} 只</span>
                </div>
                <div class="bar">
                  <span :style="{ width: Math.min(item.ratio || 0, 100) + '%' }"></span>
                </div>
                <em :class="returnClass(item.return_1y_median)">
                  {{ formatPercent(item.return_1y_median) }}
                </em>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'funds'" class="tab-section">
        <div class="card-grid">
          <div v-for="card in fundCards" :key="card.key" class="fund-card">
            <div class="fund-card-head">
              <div>
                <h3>{{ card.name }}</h3>
                <p>{{ card.summary.total }} 只，4433 通过 {{ card.summary.pass_4433 }} 只</p>
              </div>
              <span :class="returnClass(card.summary.return_1y_avg)">
                {{ formatPercent(card.summary.return_1y_avg) }}
              </span>
            </div>
            <table class="compact-table">
              <thead>
                <tr>
                  <th>基金</th>
                  <th>1年</th>
                  <th>夏普</th>
                  <th>回撤</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="fund in card.items" :key="fund.fund_code" @click="viewFund(fund)">
                  <td class="fund-identity">
                    <strong :title="fund.fund_name">{{ displayFundName(fund.fund_name) }}</strong>
                    <span>{{ fund.fund_code }}</span>
                  </td>
                  <td :class="returnClass(fund.return_1y)">{{ formatPercent(fund.return_1y) }}</td>
                  <td>{{ formatNumber(fund.sharpe_ratio_1y) }}</td>
                  <td class="down">{{ formatPercent(fund.max_drawdown_1y) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'etf'" class="tab-section">
        <div class="notice" v-if="etfSummary.net_flow_available === false">
          {{ etfSummary.net_flow_note }}
        </div>
        <div class="metric-grid etf-metrics">
          <div class="metric-card">
            <span class="metric-label">ETF/指数池</span>
            <strong>{{ etfSummary.total || 0 }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">有估值数据</span>
            <strong>{{ etfSummary.with_estimate || 0 }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">平均估值涨跌</span>
            <strong :class="returnClass(etfSummary.avg_estimate_change)">
              {{ formatPercent(etfSummary.avg_estimate_change) }}
            </strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">估值上涨占比</span>
            <strong>{{ formatPercent(etfSummary.positive_estimate_rate) }}</strong>
          </div>
        </div>

        <div class="split-grid">
          <div class="panel">
            <div class="panel-title">ETF 分类统计</div>
            <table class="data-table">
              <thead>
                <tr>
                  <th>分类</th>
                  <th>数量</th>
                  <th>估值均值</th>
                  <th>1年中位</th>
                  <th>资金流</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in etfCategories" :key="item.category">
                  <td>{{ item.category }}</td>
                  <td>{{ item.count }}</td>
                  <td :class="returnClass(item.estimate_change_avg)">
                    {{ formatPercent(item.estimate_change_avg) }}
                  </td>
                  <td :class="returnClass(item.return_1y_median)">
                    {{ formatPercent(item.return_1y_median) }}
                  </td>
                  <td>待接入</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="panel">
            <div class="panel-title">ETF 每日跟踪</div>
            <table class="data-table">
              <thead>
                <tr>
                  <th>基金</th>
                  <th>估值</th>
                  <th>1年</th>
                  <th>净值日</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="fund in etfItems" :key="fund.fund_code" @click="viewFund(fund)">
                  <td class="fund-identity">
                    <strong :title="fund.fund_name">{{ fund.fund_name }}</strong>
                    <span>{{ fund.fund_code }}</span>
                  </td>
                  <td :class="returnClass(fund.estimate_change)">{{ formatPercent(fund.estimate_change) }}</td>
                  <td :class="returnClass(fund.return_1y)">{{ formatPercent(fund.return_1y) }}</td>
                  <td>{{ fund.nav_date || '--' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'sectors'" class="tab-section">
        <div v-if="industryTaskStatus.running && industryTaskStatus.message" class="state-card compact">
          {{ industryTaskStatus.message }}
          <span v-if="industryTaskStatus.total">
            {{ industryTaskStatus.progress || 0 }}/{{ industryTaskStatus.total }}
          </span>
        </div>

        <transition name="toast-fade">
          <div v-if="showToast" class="sector-toast">
            <span class="toast-icon"><LucideIcon name="Check" :size="16" /></span>
            <span>{{ toastMessage }}</span>
            <button class="toast-close" @click="showToast = false">×</button>
          </div>
        </transition>
        <div class="metric-grid">
          <div class="metric-card">
            <span class="metric-label">行业标签</span>
            <strong>{{ industryStats.total || 0 }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">覆盖基金</span>
            <strong>{{ industryStats.fund_count || 0 }}</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">近 3 月最强</span>
            <strong :class="returnClass(industryTop3m[0]?.return_3m_median)">
              {{ industryTop3m[0]?.industry || '--' }}
            </strong>
            <small>{{ formatPercent(industryTop3m[0]?.return_3m_median) }}</small>
          </div>
          <div class="metric-card">
            <span class="metric-label">近 1 年最强</span>
            <strong :class="returnClass(industryTop1y[0]?.return_1y_median)">
              {{ industryTop1y[0]?.industry || '--' }}
            </strong>
            <small>{{ formatPercent(industryTop1y[0]?.return_1y_median) }}</small>
          </div>
        </div>

        <div class="split-grid sector-grid">
          <div class="panel">
            <div class="panel-title">近 3 月领先行业</div>
            <div class="sector-list">
              <div v-for="item in industryTop3m" :key="item.industry" class="sector-row">
                <div>
                  <strong>{{ item.industry }}</strong>
                  <span>{{ item.fund_count }} 只基金，上涨占比 {{ formatPercent(item.positive_3m_rate) }}</span>
                </div>
                <em :class="returnClass(item.return_3m_median)">{{ formatPercent(item.return_3m_median) }}</em>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-title">近 1 年领先行业</div>
            <div class="sector-list">
              <div v-for="item in industryTop1y" :key="item.industry" class="sector-row">
                <div>
                  <strong>{{ item.industry }}</strong>
                  <span>{{ item.fund_count }} 只基金，上涨占比 {{ formatPercent(item.positive_1y_rate) }}</span>
                </div>
                <em :class="returnClass(item.return_1y_median)">{{ formatPercent(item.return_1y_median) }}</em>
              </div>
            </div>
          </div>

          <div class="panel sector-full">
            <div class="panel-title">行业走势汇总</div>
            <table class="data-table">
              <thead>
                <tr>
                  <th>行业</th>
                  <th>基金数</th>
                  <th>近3月</th>
                  <th>半年</th>
                  <th>1年</th>
                  <th>3年</th>
                  <th>3月上涨</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in industryItems" :key="item.industry">
                  <td>{{ item.industry }}</td>
                  <td>{{ item.fund_count }}</td>
                  <td :class="returnClass(item.return_3m_median)">{{ formatPercent(item.return_3m_median) }}</td>
                  <td :class="returnClass(item.return_6m_median)">{{ formatPercent(item.return_6m_median) }}</td>
                  <td :class="returnClass(item.return_1y_median)">{{ formatPercent(item.return_1y_median) }}</td>
                  <td :class="returnClass(item.return_3y_median)">{{ formatPercent(item.return_3y_median) }}</td>
                  <td>{{ formatPercent(item.positive_3m_rate) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { useResearchDashboard } from '../composables/useResearchDashboard'

const emit = defineEmits(['view-fund'])
const {
  loading, error, activeTab, tabs, updatedAt,
  summary, typeStats, groupStats, fundCards,
  etfSummary, etfCategories, etfItems,
  industryStats, industryItems, industryTop3m, industryTop1y,
  industryTaskStatus, showToast, toastMessage,
  showToastNotification, loadDashboard, refreshDashboard,
  formatPercent, formatNumber, formatAmountYi,
  displayFundName, formatDateTime, returnClass, viewFund
} = useResearchDashboard(emit)
</script>

<style src="./ResearchDashboard.css" scoped></style>
