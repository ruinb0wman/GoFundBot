<template>
  <div class="realtime-container">
    <div class="top-row">
      <BButton type="primary" @click="openAddFundModal">+ {{ t('fund.realtime.addFund') }}</BButton>
      <BButton @click="refreshAll" :disabled="refreshing || funds.length === 0">{{ refreshing ? t('fund.realtime.refreshing') : t('fund.realtime.refreshEstimate') }}</BButton>
      <div class="sort-box">
        <select v-model="sortBy" class="select-sort">
          <option value="changeDesc">{{ t('fund.realtime.sortReturnDesc') }}</option>
          <option value="todayProfitDesc">{{ t('fund.realtime.sortTodayProfitDesc') }}</option>
          <option value="todayProfitAsc">{{ t('fund.realtime.sortTodayProfitAsc') }}</option>
          <option value="totalProfitDesc">{{ t('fund.realtime.sortHoldingProfitDesc') }}</option>
        </select>
      </div>
      <BButton @click="exportData">{{ t('fund.realtime.exportData') }}</BButton>
      <BFileInput accept="application/json" @change="onImport">
        <template #trigger="{ trigger }">
          <span class="import-btn" @click="trigger">{{ t('fund.realtime.importData') }}</span>
        </template>
      </BFileInput>
    </div>

    <div class="overview-box">
      <div class="overview-head">
        <div class="title-with-icon"><LucideIcon name="BarChart3" :size="18" /> {{ t('fund.realtime.overview') }}<span v-if="activeTab.startsWith('group_')" class="scope-tag">{{ portfolioGroups.find(g => 'group_' + g.id === activeTab)?.name || '' }}</span><span v-else-if="activeTab==='dividend'" class="scope-tag">{{ t('fund.realtime.dividendLowVol') }}</span></div>
        <div class="meta-info">{{ t('fund.realtime.dataDisclaimer') }} {{ nowTime }}</div>
      </div>
      <div class="overview-grid" v-if="hasHoldings">
        <div class="overview-cell purple"><div class="cell-label">{{ t('fund.realtime.totalMarket') }}</div><div class="cell-val">¥{{ fmtMoney(totalAsset) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.totalCost') }}</div><div class="cell-val">¥{{ fmtMoney(totalCost) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.grossProfit') }}</div><div class="cell-val" :class="profitBeforeFeeClass">{{ totalProfitBeforeFee >= 0 ? '+' : '' }}¥{{ fmtMoney(totalProfitBeforeFee) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.totalFee') }}</div><div class="cell-val down">-¥{{ fmtMoney(totalFee) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.netProfit') }}</div><div class="cell-val" :class="profitTotalClass">{{ totalProfitTotal >= 0 ? '+' : '' }}¥{{ fmtMoney(totalProfitTotal) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.netReturnRate') }}</div><div class="cell-val" :class="profitTotalClass">{{ fmtPercent(totalReturnRate) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.todayProfit') }}</div><div class="cell-val" :class="profitTodayClass">{{ totalProfitToday >= 0 ? '+' : '' }}¥{{ fmtMoney(totalProfitToday) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.todayReturn') }}</div><div class="cell-val" :class="profitTodayClass">{{ fmtPercent(todayReturnRate) }}</div></div>
      </div>
      <div v-else class="overview-grid empty-hint">{{ t('fund.realtime.noPosition') }}</div>

      <div class="overview-actions" v-if="hasHoldings" style="margin-top: 10px; display: flex; gap: 8px;">
        <BButton size="small" @click="showPortfolioAnalysis = !showPortfolioAnalysis">
          <LucideIcon name="PieChart" :size="14" /> AI 持仓诊断
        </BButton>
      </div>

      <PortfolioAIAnalysis
        v-if="showPortfolioAnalysis"
        :funds="funds.map(f => ({ code: f.code, share: (holdings[f.code]?.share || 0), cost: (holdings[f.code]?.cost || 0) }))"
        @close="showPortfolioAnalysis = false"
      />
    </div>

    <div class="pending-txns-bar" v-if="pendingTxns.length">
      <div class="pending-header" @click="showPending = !showPending">
        <span><LucideIcon name="Hourglass" :size="14" /> {{ pendingTxns.length }} {{ t('fund.realtime.pendingSettlement') }}</span>
        <span class="pending-toggle">{{ showPending ? t('fund.realtime.collapse') : t('fund.realtime.expand') }} <LucideIcon :name="showPending ? 'ChevronUp' : 'ChevronDown'" :size="12" /></span>
      </div>
      <div class="pending-list" v-if="showPending">
        <div class="pending-item" v-for="txn in pendingTxns" :key="txn.id">
          <span class="p-type" :class="txn.type">{{ txn.type === 'buy' ? t('fund.realtime.buy') : t('fund.realtime.sell') }}</span>
          <span class="p-name">{{ txn.fundName }}</span>
          <span class="p-val">{{ txn.type === 'buy' ? '¥' + fmtMoney(txn.inputValue) : fmtNumber(txn.inputValue) + ' 份' }}</span>
          <span class="p-date">{{ t('fund.realtime.tradeDate') }} {{ txn.tradeDate }}</span>
          <BButton size="small" @click="cancelPendingTxn(txn.id)">{{ t('fund.realtime.cancel') }}</BButton>
        </div>
      </div>
    </div>

    <div class="content-tabs">
      <div class="ctab" :class="{active: activeTab==='all'}" @click="activeTab='all'"><LucideIcon name="Briefcase" :size="16" /> 基金持仓</div>
      <div v-for="g in portfolioGroups" :key="g.id" class="ctab" :class="{active: activeTab === 'group_' + g.id}" @click="activeTab = 'group_' + g.id" @contextmenu.prevent="openGroupContextMenu($event, g.id)">
        <LucideIcon name="Folder" :size="16" /> {{ g.name }}
        <span v-if="g.rebalance_enabled && groupRebalanceWarningCount[g.id]" class="rebalance-badge" :title="rebalanceTooltip(g.id)">
          <LucideIcon name="TriangleAlert" :size="12" />
        </span>
      </div>
      <BButton circle size="small" @click="openAddGroupModal" title="新建分组" icon="FolderPlus" />
      <div v-if="hasDividendFunds" class="ctab" :class="{active: activeTab==='dividend'}" @click="activeTab='dividend'"><LucideIcon name="TrendingDown" :size="16" /> 红利低波</div>
    </div>

    <div v-if="contextMenu.show" class="context-menu" :style="{left: contextMenu.x + 'px', top: contextMenu.y + 'px'}" @click.stop>
      <div class="context-menu-item" @click="renameGroupFromMenu"><LucideIcon name="Pencil" :size="14" /> 重命名</div>
      <div class="context-menu-item danger" @click="deleteGroupFromMenu"><LucideIcon name="Trash2" :size="14" /> 删除分组</div>
    </div>

    <div class="fund-grid" v-if="displayFunds.length">
      <div v-for="(fund, index) in displayFunds" :key="fund.code" class="fund-item-card" :class="{ dragging: dragIndex === index }" :draggable="activeTab === 'all'" @dragstart="activeTab === 'all' && onDragStart($event, index)" @dragend="onDragEnd" @dragover="onDragOver($event, index)">
        <div class="card-head">
          <BButton text @click.stop="openFundDetail(fund)" title="查看基金详情">{{ fund.name }}</BButton>
          <BButton type="danger" size="small" @click.stop="removeFund(fund.code)">删除</BButton>
        </div>
        <div class="c-tags">
          <span class="tag code-tag">{{ fund.code }}</span>
          <span class="tag red" v-if="holdings[fund.code]">持仓</span>
          <span class="tag pink">场外</span>
          <div class="group-assign-wrapper" @click.stop>
            <select class="group-assign-select" :value="fundGroupMap[fund.code] || ''" @change="assignFundToGroup(fund.code, ($event.target as HTMLSelectElement).value || null)">
              <option value="">未分组</option>
              <option v-for="g in portfolioGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
        </div>
        <div class="c-hero">
          <div class="hero-metric">
            <div class="hero-chip" :class="getChangeClass(fund.gszzl)">{{ formatChange(fund.gszzl) }}</div>
            <div class="hero-label">{{ getPriceStatusLabel(fund) }}涨跌</div>
            <div class="hero-sub">单位净值 {{ fund.dwjz || '-' }}</div>
          </div>
          <div class="hero-metric" v-if="holdings[fund.code]">
            <div class="hero-chip" :class="getHoldingProfitTodayClass(fund)">{{ getHoldingProfitToday(fund) >= 0 ? '+' : '' }}¥{{ fmtMoney(getHoldingProfitToday(fund)) }}</div>
            <div class="hero-label">{{ getPriceStatusLabel(fund) }}盈亏</div>
            <div class="hero-sub">{{ hasFreshEstimate(fund) ? '估算值' : '最新净值' }} {{ formatGsz(fund) }}</div>
          </div>
        </div>
        <div class="c-holdings-area">
          <div class="c-h-head">
            <span class="c-h-title"><LucideIcon name="Briefcase" :size="14" /> 持仓信息<BButton text size="small" @click.stop="openTradeHistory(fund)" icon="FileText">{{ getFundTradeRecords(fund).length }}笔</BButton></span>
            <div class="c-h-actions">
              <BButton type="primary" size="small" round @click.stop="openTradeModal(fund, 'buy')">买卖</BButton>
              <BButton v-if="holdings[fund.code]" size="small" round @click.stop="openAdjustmentModal(fund)">修正</BButton>
            </div>
          </div>
      <div class="c-h-grid" v-if="holdings[fund.code]">
            <div class="grid-box"><div class="g-label">{{ t('fund.realtime.holdShare') }}</div><div class="g-val">{{ fmtNumber(holdings[fund.code].share) }}</div></div>
            <div class="grid-box"><div class="g-label">{{ t('fund.realtime.avgCost') }}</div><div class="g-val">{{ fmtNumber(holdings[fund.code].cost, 4) }}</div></div>
            <div class="grid-box"><div class="g-label">{{ t('fund.realtime.marketValue') }}</div><div class="g-val">¥{{ fmtMoney(getHoldingEstimatedAmount(fund)) }}</div></div>
            <div class="grid-box"><div class="g-label">{{ t('fund.realtime.principal') }}</div><div class="g-val">¥{{ fmtMoney(getHoldingCostAmount(fund)) }}</div></div>
            <div class="grid-box"><div class="g-label">{{ t('fund.realtime.fee') }}</div><div class="g-val down">-¥{{ fmtMoney(getHoldingFee(fund)) }}</div></div>
            <div class="grid-box"><div class="g-label">{{ t('fund.realtime.grossProfit') }}</div><div class="g-val" :class="getHoldingProfitBeforeFeeClass(fund)">{{ getHoldingProfitBeforeFee(fund) >= 0 ? '+' : '' }}¥{{ fmtMoney(getHoldingProfitBeforeFee(fund)) }}</div></div>
            <div class="grid-box"><div class="g-label">{{ t('fund.realtime.grossReturnRate') }}</div><div class="g-val" :class="getHoldingProfitBeforeFeeClass(fund)">{{ fmtPercent(getHoldingReturnRateBeforeFee(fund)) }}</div></div>
            <div class="grid-box"><div class="g-label">{{ t('fund.realtime.netProfit') }}</div><div class="g-val" :class="getHoldingProfitTotalClass(fund)">{{ getHoldingProfitTotal(fund) >= 0 ? '+' : '' }}¥{{ fmtMoney(getHoldingProfitTotal(fund)) }}</div></div>
            <div class="grid-box"><div class="g-label">{{ t('fund.realtime.netReturnRate') }}</div><div class="g-val" :class="getHoldingProfitTotalClass(fund)">{{ fmtPercent(getHoldingReturnRate(fund)) }}</div></div>
          </div>
          <div v-else class="c-h-grid">
            <div class="grid-box" style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary);">
              <BButton type="primary" size="small" round @click.stop="openTradeModal(fund, 'buy')">点击设置首次买入</BButton>
            </div>
          </div>
        </div>
        <div class="c-chart">
          <div v-if="getFundTrendSeries(fund).length >= 2" :ref="el => setChartRef(fund.code, el as HTMLDivElement)" class="c-echart-inner"></div>
          <div v-else class="spark-empty">暂无3月趋势</div>
        </div>
        <div class="c-time" v-if="fund.gztime">数据更新时间: {{ fund.gztime }}</div>
      </div>
    </div>
    <div v-else-if="searched" class="portfolio-empty">
      <LucideIcon name="PackageOpen" class="portfolio-empty-icon" :size="34" />
      <div class="portfolio-empty-title">{{ emptyTitle }}</div>
      <div class="portfolio-empty-hint">{{ emptyHint }}</div>
      <BButton type="primary" @click="openAddFundModal">添加基金</BButton>
    </div>
    <div v-else class="portfolio-empty">
      <LucideIcon name="PackageOpen" class="portfolio-empty-icon" :size="34" />
      <div class="portfolio-empty-title">基金持仓</div>
      <div class="portfolio-empty-hint">点击下方按钮添加基金后，即可实时查看盘中估值、持仓盈亏等数据</div>
      <BButton type="primary" @click="openAddFundModal">添加基金</BButton>
    </div>

    <FundRealtimeModals
      :add-fund-modal-open="addFundModalOpen"
      :selected-funds="selectedFunds"
      :holding-modal="holdingModal"
      :trade-form="tradeForm"
      :today-date="todayDate"
      :trade-history-modal="tradeHistoryModal"
      :trade-records="tradeHistoryModal?.fund ? getFundTradeRecords(tradeHistoryModal.fund) : []"
      :pending-txns="pendingTxns"
      :show-group-modal="showGroupModal"
      :group-name="groupName"
      :editing-group="editingGroup"
      :rebalance-form="rebalanceForm"
      :holdings="holdings"
      :funds="funds"
      :get-trade-nav="getTradeNav"
      :can-submit-trade="canSubmitTrade"
      :submit-button-text="submitButtonText"
      :format-money="formatMoney"
      :format-share="formatShare"
      :adjustment-modal="adjustmentModal"
      :adjustment-form="adjustmentForm"
      @close-add-fund="closeAddFundModal"
      @select-fund="selectFundForAdd"
      @confirm-add-fund="confirmAddFund"
      @close-holding="closeHoldingModal"
      @trade-type="(t) => tradeForm.type = t"
      @update-trade-date="(d) => tradeForm.tradeDate = d"
      @update-trade-value="(v) => tradeForm.inputValue = v"
      @save-trade="saveTrade"
      @close-trade-history="closeTradeHistory"
      @close-group="closeGroupModal"
      @save-group="saveGroup"
      @update-group-name="(n) => groupName = n"
      @update-rebalance="(field, val) => rebalanceForm[field] = val"
      @open-add-group="openAddGroupModal"
      @close-adjustment="closeAdjustmentModal"
      @save-adjustment="saveAdjustment"
      @update-adjustment-date="(d) => adjustmentForm.tradeDate = d"
      @update-adjustment-amount="(v) => adjustmentForm.amount = v"
      @update-adjustment-note="(n) => adjustmentForm.note = n"
      @update-adjustment-subtype="(v) => adjustmentForm.subtype = v"
      @update-adjustment-share="(v) => adjustmentForm.share = v"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch, nextTick } from 'vue'
import { useFundMiniChart } from '../composables/useFundMiniChart'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import BButton from './BButton.vue'
import BCard from './BCard.vue'
import BInputNumber from './BInputNumber.vue'
import BFileInput from './BFileInput.vue'
import PortfolioAIAnalysis from './PortfolioAIAnalysis.vue'
import { useFundRealtime } from '../composables/useFundRealtime'
import FundRealtimeModals from './FundRealtimeModals.vue'
import { fmtMoney, fmtPercent, fmtNumber } from '../utils/number'

defineOptions({ name: 'FundRealtime' })
const emit = defineEmits(['view-detail'])

const {
  funds, holdings, collapsedCodes, refreshing, refreshMs,
  selectedFunds, showDropdown,
  addFundModalOpen, username, nowTime, sortBy, activeTab,
  dropdownRef, searchPanelRef, searchTimeoutRef, refreshTimer,
  timeTimer, todayDate, holdingModal, tradeForm,
  pendingTxns, tradeRecords, tradeHistoryModal, showPending,
  adjustmentModal, adjustmentForm,
  dragIndex, dragOverIndex, fundOrder, portfolioGroups, fundGroupMap,
  showGroupModal, editingGroup, groupName, rebalanceForm, contextMenu,
  isTradingTime, sortedFunds, displayFunds, emptyTitle, emptyHint,
  hasHoldings, hasDividendFunds, groupRebalanceWarningCount, rebalanceTooltip,
  totalAsset, totalProfitToday, totalPreviousAsset, totalProfitTotal,
  totalProfitBeforeFee, totalFee, totalReturnRateBeforeFee,
  totalCost, totalReturnRate, todayReturnRate, profitBeforeFeeClass, profitTodayClass, profitTotalClass,
  getChangeClass, formatGsz, formatChange, getDateText, hasFreshEstimate,
  getCurrentPrice, getLatestPublishedPrice, getPriceStatusLabel, getPreviousPrice,
  getHoldingCostAmount, getHoldingEstimatedAmount,
  getHoldingProfitToday, getHoldingProfitTotal,
  getHoldingProfitBeforeFee, getHoldingProfitBeforeFeeClass, getHoldingFee,
  getHoldingReturnRate, getHoldingReturnRateBeforeFee,
  getHoldingProfitTodayClass, getHoldingProfitTotalClass, getValueClass,
  calculateShare, formatMoney, formatShare,
  buildTradeRecord, upsertTradeRecord, removeTradeRecordByTxnId,
  getTradeStatusText, getLegacyPendingRecord, getFundTradeRecords,
  toggleCollapse, isSelected, openAddFundModal, closeAddFundModal,
  selectFundForAdd, toggleSelectFund, mapPortfolioHoldings,
  mapFundDetailToRealtime, parseTrendPoint, getFundTrendSeries, getFundNavByDate,
  hasExactNavForDate, isTradeDatePending, getFundSparklinePoints, getSparklinePath,
  getSparklineFill, getFundSparklinePoints3m, getFundMiniChart3m,
  getTrendColorClass3m, performSearch, fetchFundData, addFundToRealtime,
  pickSearchCandidate, confirmAddFund, batchAddFunds,
  refreshAll, startRefreshTimer, removeFund, openFundDetail,
  onDragStart, onDragOver, onDragEnd, openAddGroupModal, openEditGroupModal,
  closeGroupModal, saveGroup, deleteGroup, assignFundToGroup,
  openGroupContextMenu, closeContextMenu, renameGroupFromMenu, deleteGroupFromMenu,
  openHoldingModal, openTradeHistory, closeTradeHistory, openTradeModal,
  openAdjustmentModal, closeAdjustmentModal, saveAdjustment,
  closeHoldingModal, clearHolding,
  getTradeNav, getTradeResultShares, canSubmitTrade, submitButtonText,
  settleTrade, genTxnId, saveTrade, cancelPendingTxn, settlePendingTxnsIfReady,
  saveRefreshMs, updateNowTime, exportData, importData, handleClickOutside,
  showPortfolioAnalysis,
} = useFundRealtime(emit)

function onImport(files: FileList | null) {
  importData({ target: { files } })
}

const searched = computed(() => funds.value.length > 0)

const { setChartRef, updateChart: updateMiniChart, echartThemeName } = useFundMiniChart()

function refreshAllCharts() {
  nextTick(() => {
    for (const fund of displayFunds.value) {
      updateMiniChart(fund.code, getFundTrendSeries(fund), getFundTradeRecords(fund))
    }
  })
}

onMounted(refreshAllCharts)
watch([displayFunds, echartThemeName], refreshAllCharts, { deep: true })
</script>

<style src="./FundRealtime.css" scoped></style>
