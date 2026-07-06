// @ts-nocheck
import Decimal from 'decimal.js'
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { fundAPI } from '../services/api'
import { portfolioAPI } from '../services/portfolioApi'
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

  const base = useFundRealtimeComputeds({
    funds, holdings, fundOrder, sortBy, activeTab,
    portfolioGroups, fundGroupMap, rebalanceThreshold,
  })

  const ensureProfitNavDates = (fundList = funds.value) => {
    let changed = false
    const nh = { ...holdings.value }
    fundList.forEach(fund => {
      const h = nh[fund.code]; const nd = getDateText(fund?.jzrq)
      if (h && h.share && nd && !h.profit_nav_date) {
        nh[fund.code] = { ...h, profit_nav_date: nd }; changed = true
      }
    })
    if (changed) holdings.value = nh
  }

  const settleOfficialNavProfits = (fundList = funds.value) => {
    let changed = false
    const nh = { ...holdings.value }
    fundList.forEach(fund => {
      const h = nh[fund.code]; const nd = getDateText(fund?.jzrq)
      if (!h || !h.share || !nd || hasFreshEstimate(fund)) return
      if (h.profit_nav_date && h.profit_nav_date >= nd) return
      nh[fund.code] = {
        ...h, profit: new Decimal(h.profit ?? 0).plus(getHoldingProfitToday(fund, holdings.value)).toNumber(),
        profit_nav_date: nd,
      }; changed = true
    })
    if (changed) holdings.value = nh
  }

  const isSelected = (code) => selectedFunds.value.some(f => f.CODE === code)

  const openAddFundModal = () => {
    addFundModalOpen.value = true
    searchTerm.value = ''; searchResults.value = []; selectedFunds.value = []; showDropdown.value = false
  }

  const closeAddFundModal = () => {
    addFundModalOpen.value = false
    searchTerm.value = ''; searchResults.value = []; selectedFunds.value = []; showDropdown.value = false
  }

  const selectFundForAdd = (f) => { selectedFunds.value = [f] }
  const toggleSelectFund = selectFundForAdd

  const toggleCollapse = (code) => {
    const next = new Set(collapsedCodes.value)
    next.has(code) ? next.delete(code) : next.add(code)
    collapsedCodes.value = next
    localStorage.setItem('realtime_collapsed', JSON.stringify([...next]))
  }

  const performSearch = async () => {
    const keyword = String(searchTerm.value || '').trim()
    if (!keyword) { searchResults.value = []; return }
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
        if (exact) selectedFunds.value = [exact]
      }
    } catch (e) { console.error('搜索失败', e); searchResults.value = []
    } finally { searchLoading.value = false }
  }

  watch(searchTerm, (val) => {
    if (searchTimeoutRef.value) clearTimeout(searchTimeoutRef.value)
    if (!String(val || '').trim()) { searchResults.value = []; return }
    searchTimeoutRef.value = setTimeout(() => performSearch(), 150)
  })

  const fetchFundData = async (code) => {
    try { return mapFundDetailToRealtime((await fundAPI.getFundCompareData(code, true))?.data || {}, code)
    } catch (e) {
      try { return mapFundDetailToRealtime((await useFundStore().fetchFund(code)) || {}, code)
      } catch {
        try { return mapFundDetailToRealtime((await fundAPI.getFundCompareData(code))?.data || {}, code)
        } catch { return null }
      }
    }
  }

  const addFundToRealtime = async (fundInfo) => {
    const code = fundInfo.fund_code || fundInfo.code || fundInfo.CODE
    if (!code || funds.value.some(f => f.code === String(code))) return
    refreshing.value = true
    try {
      const data = await fetchFundData(String(code))
      if (!data) return
      funds.value = [...funds.value, data]
      fundOrder.value = [...fundOrder.value.filter(c => c !== String(code)), String(code)]
      portfolioAPI.addFund({
        fund_code: code, fund_name: fundInfo.name || fundInfo.NAME || data.name || '',
        fund_type: fundInfo.type || data.type || '',
      }).catch(() => {})
    } catch (e) { console.error(e)
    } finally { refreshing.value = false }
  }

  const pickSearchCandidate = () => {
    if (selectedFunds.value[0]) return selectedFunds.value[0]
    const keyword = String(searchTerm.value || '').trim()
    if (/^\d{6}$/.test(keyword)) {
      return searchResults.value.find(item => item.CODE === keyword)
    }
    return searchResults.value.length === 1 ? searchResults.value[0] : null
  }

  const confirmAddFund = async () => {
    if (!selectedFunds.value.length && String(searchTerm.value || '').trim()) await performSearch()
    const fund = pickSearchCandidate()
    if (!fund?.CODE || funds.value.some(e => e.code === fund.CODE)) { closeAddFundModal(); return }
    activeTab.value = 'all'; refreshing.value = true
    try {
      const data = await fetchFundData(fund.CODE)
      if (!data) return
      funds.value = [...funds.value, data]
      fundOrder.value = [...fundOrder.value.filter(c => c !== fund.CODE), fund.CODE]
      portfolioAPI.addFund({ fund_code: fund.CODE, fund_name: fund.NAME || data.name || '', fund_type: data.type || '' }).catch(() => {})
      closeAddFundModal()
    } catch (e) { console.error(`添加基金 ${fund.CODE} 失败`, e)
    } finally { refreshing.value = false }
  }

  const batchAddFunds = async () => {
    if (selectedFunds.value.length === 0 && /^\d{6}$/.test(String(searchTerm.value || '').trim())) await performSearch()
    if (!selectedFunds.value.length) return
    refreshing.value = true
    try {
      const newFunds = []
      for (const f of selectedFunds.value) {
        if (funds.value.some(e => e.code === f.CODE)) continue
        try { const d = await fetchFundData(f.CODE); if (d) newFunds.push(d) }
        catch (e) { console.error(`添加基金 ${f.CODE} 失败`, e) }
      }
      if (newFunds.length) {
        funds.value = [...funds.value, ...newFunds]
        fundOrder.value = [...fundOrder.value, ...newFunds.map(f => f.code)]
        portfolioAPI.batchAddFunds(newFunds.map(f => ({ fund_code: f.code, fund_name: f.name || '', fund_type: f.type || '' }))).catch(() => {})
      }
      selectedFunds.value = []; searchTerm.value = ''; searchResults.value = []; showDropdown.value = false; activeTab.value = 'all'
    } catch (e) { console.error('批量添加失败', e)
    } finally { refreshing.value = false }
  }

  const removeFund = (code) => {
    funds.value = funds.value.filter(f => f.code !== code)
    fundOrder.value = fundOrder.value.filter(c => c !== code)
    if (fundGroupMap.value[code]) {
      const nm = { ...fundGroupMap.value }; delete nm[code]; fundGroupMap.value = nm
    }
    portfolioAPI.removeFund(code).catch(() => {})
    if (activeTab.value !== 'all' && base.displayFunds.value.length === 0) activeTab.value = 'all'
  }

  const refreshAll = async () => {
    if (refreshing.value || !funds.value.length) return
    refreshing.value = true
    try {
      ensureProfitNavDates(funds.value)
      const updated = []
      for (const fund of funds.value) {
        const fresh = await fetchFundData(fund.code)
        updated.push(fresh || fund)
      }
      funds.value = updated
      settleOfficialNavProfits(updated)
      updated.forEach(fund => {
        const h = holdings.value[fund.code]
        if (h) portfolioAPI.upsertHolding(fund.code, {
          share: h.share, cost: h.cost, buy_date: h.buy_date || '',
          profit: h.profit ?? 0, profit_nav_date: h.profit_nav_date || '',
        }).catch(() => {})
      })
    } catch (e) { console.error('刷新失败', e)
    } finally { refreshing.value = false; updateNowTime() }
  }

  const startRefreshTimer = () => {
    if (refreshTimer.value) clearInterval(refreshTimer.value)
    refreshTimer.value = setInterval(() => refreshAll(), refreshMs.value)
  }

  const updateNowTime = () => {
    nowTime.value = new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const saveRefreshMs = () => {
    localStorage.setItem('realtime_refresh_ms', refreshMs.value.toString())
    startRefreshTimer()
  }

  const onDragStart = (event, index) => { dragIndex.value = index; event.dataTransfer.effectAllowed = 'move' }
  const onDragOver = (event, index) => { event.preventDefault(); dragOverIndex.value = index }

  const onDragEnd = () => {
    if (dragIndex.value !== null && dragOverIndex.value !== null && dragIndex.value !== dragOverIndex.value) {
      const codes = base.displayFunds.value.map(f => f.code)
      const [moved] = codes.splice(dragIndex.value, 1)
      codes.splice(dragOverIndex.value, 0, moved)
      fundOrder.value = codes
      portfolioAPI.reorderFunds(codes).catch(() => {})
    }
    dragIndex.value = null; dragOverIndex.value = null
  }

  const openFundDetail = (fund) => emit('view-detail', { code: fund.code, name: fund.name })

  const exportData = () => {
    const payload = { funds: funds.value, holdings: holdings.value, fundOrder: fundOrder.value, portfolioGroups: portfolioGroups.value, fundGroupMap: fundGroupMap.value }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `gofundbot-realtime-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const importData = async (event) => {
    const file = event?.target?.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (Array.isArray(parsed.funds)) funds.value = parsed.funds
      if (parsed.holdings && typeof parsed.holdings === 'object') holdings.value = parsed.holdings
      if (Array.isArray(parsed.fundOrder)) fundOrder.value = parsed.fundOrder
      if (Array.isArray(parsed.portfolioGroups)) portfolioGroups.value = parsed.portfolioGroups
      if (parsed.fundGroupMap && typeof parsed.fundGroupMap === 'object') fundGroupMap.value = parsed.fundGroupMap
      refreshAll()
      portfolioAPI.migrate(parsed).catch(() => {})
    } catch (error) { console.error('导入失败', error)
    } finally { event.target.value = '' }
  }

  const handleClickOutside = (event) => {
    if (searchPanelRef.value && !searchPanelRef.value.contains(event.target) && dropdownRef.value && !dropdownRef.value.contains(event.target)) {
      showDropdown.value = false
    }
  }

  onMounted(async () => {
    try {
      const res = await portfolioAPI.getFunds()
      const data = res?.data
      if (Array.isArray(data) && data.length) {
        const apiFunds = data.map(f => ({ code: f.fund_code, name: f.fund_name, type: f.fund_type })).filter(f => f.code)
        fundOrder.value = data.map(f => f.fund_code)
        if (apiFunds.length) { funds.value = apiFunds; refreshAll() }
      }
    } catch { console.warn('加载自选列表失败') }

    try {
      const res = await portfolioAPI.getHoldings()
      const data = res?.data
      if (data && typeof data === 'object') holdings.value = data
    } catch { console.warn('加载持仓数据失败') }

    ensureProfitNavDates(funds.value)

    const savedMs = parseInt(localStorage.getItem('realtime_refresh_ms') || '180000', 10)
    if (Number.isFinite(savedMs) && savedMs >= 5000) refreshMs.value = savedMs
    const sc = JSON.parse(localStorage.getItem('realtime_collapsed') || '[]')
    if (Array.isArray(sc)) collapsedCodes.value = new Set(sc)
    const so = JSON.parse(localStorage.getItem('realtime_fund_order') || 'null')
    if (Array.isArray(so) && so.length) fundOrder.value = so
    else if (funds.value.length) fundOrder.value = funds.value.map(f => f.code)
    const ss = localStorage.getItem('realtime_sort_by'); if (ss) sortBy.value = ss
    const su = localStorage.getItem('gofundbot_user'); if (su) username.value = su
    const st = parseInt(localStorage.getItem('realtime_rebalance_threshold') || '8', 10)
    if (st >= 1) rebalanceThreshold.value = st

    startRefreshTimer(); updateNowTime()
    timeTimer.value = setInterval(updateNowTime, 60000)
    document.addEventListener('mousedown', handleClickOutside)
  })

  onUnmounted(() => {
    if (refreshTimer.value) clearInterval(refreshTimer.value)
    if (timeTimer.value) clearInterval(timeTimer.value)
    document.removeEventListener('mousedown', handleClickOutside)
  })

  watch(sortBy, (v) => localStorage.setItem('realtime_sort_by', v))
  watch([base.hasRebalanceFunds, base.hasDividendFunds], ([r, d]) => {
    if (activeTab.value === 'rebalance' && !r) activeTab.value = 'all'
    if (activeTab.value === 'dividend' && !d) activeTab.value = 'all'
  })
  watch(rebalanceThreshold, (v) => localStorage.setItem('realtime_rebalance_threshold', String(v)))

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
