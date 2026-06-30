// @ts-nocheck
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { fundAPI } from '../services/api'
import { useFundStore } from '../stores/fundStore'
import {
  getDateText, getCurrentPrice, getLatestPublishedPrice, getPreviousPrice,
  getHoldingProfitToday, getHoldingEstimatedAmount, getHoldingProfitTotal,
  getHoldingAmount, mapFundDetailToRealtime, hasFreshEstimate,
} from './useFundRealtimeBase'
import { useFundRealtimeComputeds } from './useFundRealtimeComputeds'

export function useFundRealtimeData(emit, extra = {}) {
  const { portfolioGroups = ref([]), fundGroupMap = ref({}) } = extra

  const funds = ref([])
  const holdings = ref({})
  const collapsedCodes = ref(new Set())
  const refreshing = ref(false)
  const refreshMs = ref(180000)
  const searchTerm = ref('')
  const searchResults = ref([])
  const selectedFunds = ref([])
  const showDropdown = ref(false)
  const addFundModalOpen = ref(false)
  const username = ref('guest')
  const nowTime = ref('--:--')
  const sortBy = ref('changeDesc')
  const activeTab = ref('all')
  const dropdownRef = ref(null)
  const searchPanelRef = ref(null)
  const searchTimeoutRef = ref(null)
  const refreshTimer = ref(null)
  const timeTimer = ref(null)
  const searchLoading = ref(false)
  const todayDate = ref(new Date().toISOString().slice(0, 10))
  const fundOrder = ref([])
  const dragIndex = ref(null)
  const dragOverIndex = ref(null)
  const rebalanceThreshold = ref(8)

  // Computed properties
  const base = useFundRealtimeComputeds({
    funds, holdings, fundOrder, sortBy, activeTab,
    portfolioGroups, fundGroupMap, rebalanceThreshold,
  })

  // ==================== Helper functions ====================

  const ensureProfitNavDates = (fundList = funds.value) => {
    let changed = false
    const newHoldings = { ...holdings.value }
    fundList.forEach(fund => {
      const h = newHoldings[fund.code]
      const navDate = getDateText(fund?.jzrq)
      if (h && h.share && navDate && !h.profit_nav_date) {
        newHoldings[fund.code] = { ...h, profit_nav_date: navDate }
        changed = true
      }
    })
    if (changed) {
      holdings.value = newHoldings
      localStorage.setItem('realtime_holdings', JSON.stringify(newHoldings))
    }
  }

  const settleOfficialNavProfits = (fundList = funds.value) => {
    let changed = false
    const newHoldings = { ...holdings.value }
    fundList.forEach(fund => {
      const h = newHoldings[fund.code]
      const navDate = getDateText(fund?.jzrq)
      if (!h || !h.share || !navDate || hasFreshEstimate(fund)) return
      if (h.profit_nav_date && h.profit_nav_date >= navDate) return
      newHoldings[fund.code] = {
        ...h,
        profit: parseFloat(((h.profit ?? 0) + getHoldingProfitToday(fund, holdings.value)).toFixed(2)),
        profit_nav_date: navDate
      }
      changed = true
    })
    if (changed) {
      holdings.value = newHoldings
      localStorage.setItem('realtime_holdings', JSON.stringify(newHoldings))
    }
  }

  const hasFreshEstimate = (fund) => {
    const estimate = Number(fund?.gsz)
    if (!Number.isFinite(estimate) || estimate <= 0) return false
    const estimateDate = getDateText(fund?.gztime)
    const navDate = getDateText(fund?.jzrq)
    return !!estimateDate && !!navDate && estimateDate > navDate
  }

  const isSelected = (code) => selectedFunds.value.some(f => f.CODE === code)

  // ==================== Modal state ====================

  const openAddFundModal = () => {
    addFundModalOpen.value = true
    searchTerm.value = ''
    searchResults.value = []
    selectedFunds.value = []
    showDropdown.value = false
  }

  const closeAddFundModal = () => {
    addFundModalOpen.value = false
    searchTerm.value = ''
    searchResults.value = []
    selectedFunds.value = []
    showDropdown.value = false
  }

  const selectFundForAdd = (fund) => {
    selectedFunds.value = [fund]
  }

  const toggleSelectFund = (fund) => {
    selectFundForAdd(fund)
  }

  const toggleCollapse = (code) => {
    const next = new Set(collapsedCodes.value)
    if (next.has(code)) {
      next.delete(code)
    } else {
      next.add(code)
    }
    collapsedCodes.value = next
    localStorage.setItem('realtime_collapsed', JSON.stringify([...next]))
  }

  // ==================== Search & Data Fetching ====================

  const performSearch = async () => {
    const keyword = String(searchTerm.value || '').trim()
    if (!keyword) {
      searchResults.value = []
      return
    }
    try {
      searchLoading.value = true
      const res = await fundAPI.searchFunds(keyword)
      const payload = res?.data?.data
      const list = Array.isArray(payload) ? payload : (payload?.funds || [])
      searchResults.value = list.map(item => ({
        CODE: item.fund_code || item.CODE || item.code,
        NAME: item.fund_name || item.NAME || item.name
      })).filter(item => item.CODE && item.NAME)
      showDropdown.value = true
      if (/^\d{6}$/.test(keyword)) {
        const exact = searchResults.value.find(item => item.CODE === keyword)
        if (exact) {
          selectedFunds.value = [exact]
        }
      }
    } catch (e) {
      console.error('搜索失败', e)
      searchResults.value = []
    } finally {
      searchLoading.value = false
    }
  }

  watch(searchTerm, (val) => {
    if (searchTimeoutRef.value) clearTimeout(searchTimeoutRef.value)
    if (!String(val || '').trim()) {
      searchResults.value = []
      return
    }
    searchTimeoutRef.value = setTimeout(() => performSearch(), 150)
  })

  const fetchFundData = async (code) => {
    try {
      const freshRes = await fundAPI.getFundCompareData(code, true)
      return mapFundDetailToRealtime(freshRes?.data || {}, code)
    } catch (e) {
      try {
        const fundStore = useFundStore()
        const data = await fundStore.fetchFund(code)
        return mapFundDetailToRealtime(data || {}, code)
      } catch {
        const cachedRes = await fundAPI.getFundCompareData(code)
        return mapFundDetailToRealtime(cachedRes?.data || {}, code)
      }
    }
  }

  const addFundToRealtime = async (fundInfo) => {
    const code = fundInfo.fund_code || fundInfo.code || fundInfo.CODE
    if (!code) return
    if (funds.value.some(f => f.code === String(code))) return
    refreshing.value = true
    try {
      const data = await fetchFundData(String(code))
      funds.value = [...funds.value, data]
      localStorage.setItem('realtime_funds', JSON.stringify(funds.value))
      fundOrder.value = [...fundOrder.value.filter(c => c !== String(code)), String(code)]
      localStorage.setItem('realtime_fund_order', JSON.stringify(fundOrder.value))
    } catch (e) {
      console.error(e)
    } finally {
      refreshing.value = false
    }
  }

  const pickSearchCandidate = () => {
    const keyword = String(searchTerm.value || '').trim()
    if (selectedFunds.value[0]) return selectedFunds.value[0]
    if (/^\d{6}$/.test(keyword)) {
      const exact = searchResults.value.find(item => item.CODE === keyword)
      if (exact) return exact
    }
    return searchResults.value.length === 1 ? searchResults.value[0] : null
  }

  const confirmAddFund = async () => {
    if (!selectedFunds.value.length && String(searchTerm.value || '').trim()) {
      await performSearch()
    }
    const fund = pickSearchCandidate()
    if (!fund?.CODE) return
    activeTab.value = 'all'
    if (funds.value.some(existing => existing.code === fund.CODE)) {
      closeAddFundModal()
      return
    }
    refreshing.value = true
    try {
      const data = await fetchFundData(fund.CODE)
      const updated = [...funds.value, data]
      funds.value = updated
      localStorage.setItem('realtime_funds', JSON.stringify(updated))
      fundOrder.value = [...fundOrder.value.filter(c => c !== fund.CODE), fund.CODE]
      localStorage.setItem('realtime_fund_order', JSON.stringify(fundOrder.value))
      closeAddFundModal()
    } catch (e) {
      console.error(`添加基金 ${fund.CODE} 失败`, e)
    } finally {
      refreshing.value = false
    }
  }

  const batchAddFunds = async () => {
    if (selectedFunds.value.length === 0 && /^\d{6}$/.test(String(searchTerm.value || '').trim())) {
      await performSearch()
    }
    if (selectedFunds.value.length === 0) return
    refreshing.value = true
    try {
      const newFunds = []
      for (const f of selectedFunds.value) {
        if (funds.value.some(existing => existing.code === f.CODE)) continue
        try {
          const data = await fetchFundData(f.CODE)
          newFunds.push(data)
        } catch (e) {
          console.error(`添加基金 ${f.CODE} 失败`, e)
        }
      }
      if (newFunds.length > 0) {
        const updated = [...funds.value, ...newFunds]
        funds.value = updated
        localStorage.setItem('realtime_funds', JSON.stringify(updated))
        const newCodes = newFunds.map(f => f.code)
        fundOrder.value = [...fundOrder.value, ...newCodes]
        localStorage.setItem('realtime_fund_order', JSON.stringify(fundOrder.value))
      }
      selectedFunds.value = []
      searchTerm.value = ''
      searchResults.value = []
      showDropdown.value = false
      activeTab.value = 'all'
    } catch (e) {
      console.error('批量添加失败', e)
    } finally {
      refreshing.value = false
    }
  }

  const removeFund = (code) => {
    funds.value = funds.value.filter(f => f.code !== code)
    localStorage.setItem('realtime_funds', JSON.stringify(funds.value))
    fundOrder.value = fundOrder.value.filter(c => c !== code)
    localStorage.setItem('realtime_fund_order', JSON.stringify(fundOrder.value))
    if (fundGroupMap.value[code]) {
      const newMap = { ...fundGroupMap.value }
      delete newMap[code]
      fundGroupMap.value = newMap
      localStorage.setItem('realtime_fund_group_map', JSON.stringify(newMap))
    }
    if (activeTab.value !== 'all' && base.displayFunds.value.length === 0) {
      activeTab.value = 'all'
    }
  }

  const refreshAll = async () => {
    if (refreshing.value || funds.value.length === 0) return
    refreshing.value = true
    try {
      ensureProfitNavDates(funds.value)
      const updated = []
      for (const fund of funds.value) {
        try {
          const data = await fetchFundData(fund.code)
          updated.push(data)
        } catch (e) {
          console.error(`刷新基金 ${fund.code} 失败`, e)
          updated.push(fund)
        }
      }
      funds.value = updated
      localStorage.setItem('realtime_funds', JSON.stringify(updated))
      settleOfficialNavProfits(updated)
    } catch (e) {
      console.error('刷新失败', e)
    } finally {
      refreshing.value = false
      updateNowTime()
    }
  }

  const startRefreshTimer = () => {
    if (refreshTimer.value) clearInterval(refreshTimer.value)
    refreshTimer.value = setInterval(() => {
      refreshAll()
    }, refreshMs.value)
  }

  const updateNowTime = () => {
    nowTime.value = new Date().toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const saveRefreshMs = () => {
    localStorage.setItem('realtime_refresh_ms', refreshMs.value.toString())
    startRefreshTimer()
  }

  // ==================== Drag & Drop ====================

  const onDragStart = (event, index) => {
    dragIndex.value = index
    event.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (event, index) => {
    event.preventDefault()
    dragOverIndex.value = index
  }

  const onDragEnd = () => {
    if (dragIndex.value !== null && dragOverIndex.value !== null && dragIndex.value !== dragOverIndex.value) {
      const displayCodes = base.displayFunds.value.map(f => f.code)
      const [moved] = displayCodes.splice(dragIndex.value, 1)
      displayCodes.splice(dragOverIndex.value, 0, moved)
      fundOrder.value = displayCodes
      localStorage.setItem('realtime_fund_order', JSON.stringify(displayCodes))
    }
    dragIndex.value = null
    dragOverIndex.value = null
  }

  // ==================== Misc ====================

  const openFundDetail = (fund) => {
    emit('view-detail', { code: fund.code, name: fund.name })
  }

  const exportData = () => {
    const payload = {
      funds: funds.value,
      holdings: holdings.value,
      pendingTxns: [],
      tradeRecords: [],
      fundOrder: fundOrder.value,
      portfolioGroups: portfolioGroups.value,
      fundGroupMap: fundGroupMap.value,
      exportedAt: new Date().toISOString()
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gofundbot-realtime-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const importData = async (event) => {
    const file = event?.target?.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed.funds)) {
        funds.value = parsed.funds
        localStorage.setItem('realtime_funds', JSON.stringify(parsed.funds))
      }
      if (parsed.holdings && typeof parsed.holdings === 'object') {
        holdings.value = parsed.holdings
        localStorage.setItem('realtime_holdings', JSON.stringify(parsed.holdings))
      }
      if (Array.isArray(parsed.pendingTxns)) {
        localStorage.setItem('realtime_pending_txns', JSON.stringify(parsed.pendingTxns))
      }
      if (Array.isArray(parsed.tradeRecords)) {
        localStorage.setItem('realtime_trade_records', JSON.stringify(parsed.tradeRecords))
      }
      if (Array.isArray(parsed.fundOrder)) {
        fundOrder.value = parsed.fundOrder
        localStorage.setItem('realtime_fund_order', JSON.stringify(parsed.fundOrder))
      }
      if (Array.isArray(parsed.portfolioGroups)) {
        portfolioGroups.value = parsed.portfolioGroups
        localStorage.setItem('realtime_portfolio_groups', JSON.stringify(parsed.portfolioGroups))
      }
      if (parsed.fundGroupMap && typeof parsed.fundGroupMap === 'object') {
        fundGroupMap.value = parsed.fundGroupMap
        localStorage.setItem('realtime_fund_group_map', JSON.stringify(parsed.fundGroupMap))
      }
      refreshAll()
    } catch (error) {
      console.error('导入失败', error)
    } finally {
      event.target.value = ''
    }
  }

  const handleClickOutside = (event) => {
    if (searchPanelRef.value && !searchPanelRef.value.contains(event.target) && dropdownRef.value && !dropdownRef.value.contains(event.target)) {
      showDropdown.value = false
    }
  }

  // ==================== Lifecycle ====================

  onMounted(() => {
    try {
      const savedFunds = JSON.parse(localStorage.getItem('realtime_funds') || '[]')
      if (Array.isArray(savedFunds) && savedFunds.length) {
        funds.value = savedFunds
        refreshAll()
      }
      const savedHoldings = JSON.parse(localStorage.getItem('realtime_holdings') || '{}')
      if (savedHoldings && typeof savedHoldings === 'object') {
        holdings.value = savedHoldings
      }
      const savedMs = parseInt(localStorage.getItem('realtime_refresh_ms') || '180000', 10)
      if (Number.isFinite(savedMs) && savedMs >= 5000) {
        refreshMs.value = savedMs
      }
      const savedCollapsed = JSON.parse(localStorage.getItem('realtime_collapsed') || '[]')
      if (Array.isArray(savedCollapsed)) {
        collapsedCodes.value = new Set(savedCollapsed)
      }
      const savedPending = JSON.parse(localStorage.getItem('realtime_pending_txns') || '[]')
      if (Array.isArray(savedPending)) {
        localStorage.setItem('realtime_pending_txns', JSON.stringify(savedPending))
      }
      const savedTradeRecords = JSON.parse(localStorage.getItem('realtime_trade_records') || '[]')
      if (Array.isArray(savedTradeRecords)) {
        localStorage.setItem('realtime_trade_records', JSON.stringify(savedTradeRecords))
      }
      ensureProfitNavDates(funds.value)
    } catch (e) {
      console.error('加载本地数据失败', e)
    }

    try {
      const savedOrder = JSON.parse(localStorage.getItem('realtime_fund_order') || 'null')
      if (Array.isArray(savedOrder) && savedOrder.length) {
        fundOrder.value = savedOrder
      } else if (Array.isArray(funds.value) && funds.value.length) {
        fundOrder.value = funds.value.map(f => f.code)
      }
    } catch (e) { /* ignore */ }

    try {
      const savedGroups = JSON.parse(localStorage.getItem('realtime_portfolio_groups') || '[]')
      if (Array.isArray(savedGroups)) portfolioGroups.value = savedGroups
    } catch (e) { /* ignore */ }

    try {
      const savedGroupMap = JSON.parse(localStorage.getItem('realtime_fund_group_map') || '{}')
      if (savedGroupMap && typeof savedGroupMap === 'object') fundGroupMap.value = savedGroupMap
    } catch (e) { /* ignore */ }

    startRefreshTimer()
    updateNowTime()
    timeTimer.value = setInterval(updateNowTime, 60000)
    document.addEventListener('mousedown', handleClickOutside)
    const savedSortBy = localStorage.getItem('realtime_sort_by')
    if (savedSortBy) sortBy.value = savedSortBy
    const savedUser = localStorage.getItem('gofundbot_user')
    if (savedUser) username.value = savedUser
    const savedThreshold = parseInt(localStorage.getItem('realtime_rebalance_threshold') || '8', 10)
    if (savedThreshold >= 1) rebalanceThreshold.value = savedThreshold
  })

  onUnmounted(() => {
    if (refreshTimer.value) clearInterval(refreshTimer.value)
    if (timeTimer.value) clearInterval(timeTimer.value)
    document.removeEventListener('mousedown', handleClickOutside)
  })

  watch(sortBy, (value) => {
    localStorage.setItem('realtime_sort_by', value)
  })

  watch([base.hasRebalanceFunds, base.hasDividendFunds], ([hasReb, hasDiv]) => {
    if (activeTab.value === 'rebalance' && !hasReb) activeTab.value = 'all'
    if (activeTab.value === 'dividend' && !hasDiv) activeTab.value = 'all'
  })

  watch(rebalanceThreshold, (val) => {
    localStorage.setItem('realtime_rebalance_threshold', String(val))
  })

  return {
    funds, holdings, collapsedCodes, refreshing, refreshMs,
    searchTerm, searchResults, selectedFunds, showDropdown,
    addFundModalOpen, username, nowTime, sortBy, activeTab,
    dropdownRef, searchPanelRef, searchTimeoutRef, refreshTimer,
    timeTimer, searchLoading, todayDate,
    fundOrder, dragIndex, dragOverIndex, rebalanceThreshold,
    portfolioGroups, fundGroupMap,
    ...base,
    ensureProfitNavDates, settleOfficialNavProfits, isSelected,
    openAddFundModal, closeAddFundModal, selectFundForAdd, toggleSelectFund,
    toggleCollapse, performSearch, fetchFundData, addFundToRealtime,
    pickSearchCandidate, confirmAddFund, batchAddFunds,
    refreshAll, startRefreshTimer, removeFund, openFundDetail,
    onDragStart, onDragOver, onDragEnd,
    saveRefreshMs, updateNowTime, exportData, importData, handleClickOutside,
  }
}
