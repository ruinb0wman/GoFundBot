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
        <div class="title-with-icon"><LucideIcon name="BarChart3" :size="18" /> {{ t('fund.realtime.overview') }}<span v-if="activeTab.startsWith('group_')" class="scope-tag">{{ portfolioGroups.find(g => 'group_' + g.id === activeTab)?.name || '' }}</span><span v-else-if="activeTab==='rebalance'" class="scope-tag">{{ t('fund.realtime.rebalance') }}</span><span v-else-if="activeTab==='dividend'" class="scope-tag">{{ t('fund.realtime.dividendLowVol') }}</span></div>
        <div class="meta-info">{{ t('fund.realtime.dataDisclaimer') }} {{ nowTime }}</div>
      </div>
      <div class="overview-grid" v-if="hasHoldings">
        <div class="overview-cell purple"><div class="cell-label">{{ t('fund.realtime.totalMarket') }}</div><div class="cell-val">¥{{ totalAsset.toFixed(2) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.totalCost') }}</div><div class="cell-val">¥{{ totalCost.toFixed(2) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.totalProfit') }}</div><div class="cell-val" :class="profitTotalClass">{{ totalProfitTotal >= 0 ? '+' : '' }}¥{{ totalProfitTotal.toFixed(2) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.returnRate') }}</div><div class="cell-val" :class="profitTotalClass">{{ totalReturnRate >= 0 ? '+' : '' }}{{ totalReturnRate.toFixed(2) }}%</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.todayProfit') }}</div><div class="cell-val" :class="profitTodayClass">{{ totalProfitToday >= 0 ? '+' : '' }}¥{{ totalProfitToday.toFixed(2) }}</div></div>
        <div class="overview-cell"><div class="cell-label">{{ t('fund.realtime.todayReturn') }}</div><div class="cell-val" :class="profitTodayClass">{{ todayReturnRate >= 0 ? '+' : '' }}{{ todayReturnRate.toFixed(2) }}%</div></div>
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
          <span class="p-val">{{ txn.type === 'buy' ? '¥' + txn.inputValue.toFixed(2) : txn.inputValue.toFixed(2) + ' 份' }}</span>
          <span class="p-date">{{ t('fund.realtime.tradeDate') }} {{ txn.tradeDate }}</span>
          <BButton size="small" @click="cancelPendingTxn(txn.id)">{{ t('fund.realtime.cancel') }}</BButton>
        </div>
      </div>
    </div>

    <div class="content-tabs">
      <div class="ctab" :class="{active: activeTab==='all'}" @click="activeTab='all'"><LucideIcon name="Briefcase" :size="16" /> 基金持仓</div>
      <div v-for="g in portfolioGroups" :key="g.id" class="ctab" :class="{active: activeTab === 'group_' + g.id}" @click="activeTab = 'group_' + g.id" @contextmenu.prevent="openGroupContextMenu($event, g.id)"><LucideIcon name="Folder" :size="16" /> {{ g.name }}</div>
      <BButton circle size="small" @click="openAddGroupModal" title="新建分组" icon="FolderPlus" />
      <div v-if="hasRebalanceFunds" class="ctab" :class="{active: activeTab==='rebalance'}" @click="activeTab='rebalance'"><LucideIcon name="Scale" :size="16" /> 再平衡管理</div>
      <span v-if="activeTab === 'rebalance'" class="threshold-label"><span class="threshold-prefix">≥</span><BInputNumber v-model="rebalanceThreshold" :min="1" :step="1" :controls="false" size="small" style="width:64px" /><span class="threshold-suffix">%</span></span>
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
            <div class="hero-chip" :class="getHoldingProfitTodayClass(fund)">{{ getHoldingProfitToday(fund) >= 0 ? '+' : '' }}¥{{ getHoldingProfitToday(fund).toFixed(2) }}</div>
            <div class="hero-label">{{ getPriceStatusLabel(fund) }}盈亏</div>
            <div class="hero-sub">{{ hasFreshEstimate(fund) ? '估算值' : '最新净值' }} {{ formatGsz(fund) }}</div>
          </div>
        </div>
        <div class="c-holdings-area">
          <div class="c-h-head">
            <span class="c-h-title"><LucideIcon name="Briefcase" :size="14" /> 持仓信息<BButton text size="small" @click.stop="openTradeHistory(fund)" icon="FileText">{{ getFundTradeRecords(fund).length }}笔</BButton></span>
            <div class="c-h-actions">
              <BButton type="primary" size="small" round @click.stop="openTradeModal(fund, 'buy')">买卖</BButton>
              <BButton v-if="holdings[fund.code]" size="small" round @click.stop="openEditModal(fund)">修改</BButton>
            </div>
          </div>
          <div class="c-h-grid" v-if="holdings[fund.code]">
            <div class="grid-box"><div class="g-label">持有份额</div><div class="g-val">{{ holdings[fund.code].share.toFixed(2) }}</div></div>
            <div class="grid-box"><div class="g-label">平均成本</div><div class="g-val">{{ holdings[fund.code].cost.toFixed(4) }}</div></div>
            <div class="grid-box"><div class="g-label">当前市值</div><div class="g-val">¥{{ getHoldingEstimatedAmount(fund).toFixed(2) }}</div></div>
            <div class="grid-box"><div class="g-label">投入本金</div><div class="g-val">¥{{ getHoldingCostAmount(fund).toFixed(2) }}</div></div>
            <div class="grid-box"><div class="g-label">收益金额</div><div class="g-val" :class="getHoldingProfitTotalClass(fund)">{{ getHoldingProfitTotal(fund) >= 0 ? '+' : '' }}¥{{ getHoldingProfitTotal(fund).toFixed(2) }}</div></div>
            <div class="grid-box"><div class="g-label">收益率</div><div class="g-val" :class="getHoldingProfitTotalClass(fund)">{{ getHoldingReturnRate(fund) >= 0 ? '+' : '' }}{{ getHoldingReturnRate(fund).toFixed(2) }}%</div></div>
          </div>
          <div v-else class="c-h-grid">
            <div class="grid-box" style="grid-column: 1 / -1; text-align: center; color: var(--text-tertiary);">
              <BButton type="primary" size="small" round @click.stop="openTradeModal(fund, 'buy')">点击设置首次买入</BButton>
            </div>
          </div>
        </div>
        <div class="c-chart">
          <svg v-if="getFundMiniChart3m(fund).points.length > 1" viewBox="0 0 110 64" preserveAspectRatio="none" class="c-svg">
            <line class="c-axis" x1="20" y1="28" x2="106" y2="28"></line>
            <line class="c-axis" x1="20" y1="4" x2="20" y2="28"></line>
            <line v-for="tick in getFundMiniChart3m(fund).yTicks" :key="`grid-${fund.code}-${tick.y}`" class="c-grid" x1="20" :y1="tick.y" x2="106" :y2="tick.y"></line>
            <path class="c-fill" :class="getFundMiniChart3m(fund).trendUp ? 'up' : 'down'" :d="getSparklineFill(getFundMiniChart3m(fund).points, 48)"></path>
            <path class="c-line" :class="getFundMiniChart3m(fund).trendUp ? 'up' : 'down'" :d="getSparklinePath(getFundMiniChart3m(fund).points)"></path>
            <text v-for="tick in getFundMiniChart3m(fund).yTicks" :key="`y-${fund.code}-${tick.y}`" class="c-y-label" x="18" :y="tick.y + 1" text-anchor="end">{{ tick.label }}</text>
            <text v-for="tick in getFundMiniChart3m(fund).xTicks" :key="`x-${fund.code}-${tick.x}`" class="c-x-label" :x="tick.x" y="55" text-anchor="middle">{{ tick.label }}</text>
          </svg>
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
      :show-edit-modal="showEditModal"
      :edit-form="editForm"
      :holdings="holdings"
      :funds="funds"
      :get-trade-nav="getTradeNav"
      :can-submit-trade="canSubmitTrade"
      :submit-button-text="submitButtonText"
      :format-money="formatMoney"
      :format-share="formatShare"
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
      @close-edit="closeEditModal"
      @save-edit="saveEdit"
      @update-edit-amount="(v) => editForm.amount = v"
      @update-edit-profit="(v) => editForm.profit = v"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import BButton from './BButton.vue'
import BCard from './BCard.vue'
import BInputNumber from './BInputNumber.vue'
import BFileInput from './BFileInput.vue'
import PortfolioAIAnalysis from './PortfolioAIAnalysis.vue'
import { useFundRealtime } from '../composables/useFundRealtime'
import FundRealtimeModals from './FundRealtimeModals.vue'

defineOptions({ name: 'FundRealtime' })
const emit = defineEmits(['view-detail'])

const {
  funds, holdings, collapsedCodes, refreshing, refreshMs,
  selectedFunds, showDropdown,
  addFundModalOpen, username, nowTime, sortBy, activeTab,
  dropdownRef, searchPanelRef, searchTimeoutRef, refreshTimer,
  timeTimer, todayDate, holdingModal, tradeForm,
  pendingTxns, tradeRecords, tradeHistoryModal, showPending,
  dragIndex, dragOverIndex, fundOrder, portfolioGroups, fundGroupMap,
  showGroupModal, editingGroup, groupName, contextMenu,
  rebalanceThreshold, showEditModal, editForm,
  isTradingTime, sortedFunds, displayFunds, emptyTitle, emptyHint,
  hasHoldings, hasRebalanceFunds, hasDividendFunds,
  totalAsset, totalProfitToday, totalPreviousAsset, totalProfitTotal,
  totalCost, totalReturnRate, todayReturnRate, profitTodayClass, profitTotalClass,
  getChangeClass, formatGsz, formatChange, getDateText, hasFreshEstimate,
  getCurrentPrice, getLatestPublishedPrice, getPriceStatusLabel, getPreviousPrice,
  getHoldingAmount, getHoldingCostAmount, getHoldingEstimatedAmount,
  getHoldingProfitToday, getHoldingProfitTotal, getHoldingPrincipalAmount,
  getHoldingReturnRate, ensureProfitNavDates, settleOfficialNavProfits,
  getHoldingProfitTodayClass, getHoldingProfitTotalClass,
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
  openEditModal, closeEditModal, saveEdit, closeHoldingModal, clearHolding,
  getTradeNav, getTradeResultShares, canSubmitTrade, submitButtonText,
  settleTrade, genTxnId, saveTrade, cancelPendingTxn, settlePendingTxnsIfReady,
  saveRefreshMs, updateNowTime, exportData, importData, handleClickOutside,
  showPortfolioAnalysis,
} = useFundRealtime(emit)

function onImport(files: FileList | null) {
  importData({ target: { files } })
}

const searched = computed(() => funds.value.length > 0)
</script>

<style src="./FundRealtime.css" scoped></style>
