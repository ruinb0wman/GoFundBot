// @ts-nocheck
import { ref, onMounted } from 'vue'
import { portfolioAPI } from '../services/portfolioApi'
import {
  getFundNavByDate, getCurrentPrice, getDateText, hasExactNavForDate,
  getHoldingAmount, getHoldingProfitTotal, hasFreshEstimate,
  getFundTrendSeries, buildTradeRecord, genTxnId,
} from './useFundRealtimeBase'

export function useFundRealtimeTrade(funds, holdings, todayDate, refreshMs) {
  const holdingModal = ref({ open: false, fund: null })
  const tradeForm = ref({ type: 'buy', inputValue: '', tradeDate: todayDate.value })
  const pendingTxns = ref([])
  const tradeRecords = ref([])
  const tradeHistoryModal = ref({ open: false, fund: null })
  const showPending = ref(false)
  const showEditModal = ref(false)
  const editForm = ref({ fund: null, amount: '', profit: 0 })

  const upsertTradeRecord = (record) => {
    const idx = tradeRecords.value.findIndex(r => r.id === record.id || (record.txnId && r.txnId === record.txnId))
    if (idx >= 0) {
      const next = [...tradeRecords.value]
      next[idx] = { ...next[idx], ...record }
      tradeRecords.value = next
    } else {
      tradeRecords.value = [record, ...tradeRecords.value]
    }
    portfolioAPI.addTrade({
      fund_code: record.fundCode,
      fund_name: record.fundName,
      type: record.type,
      trade_date: record.tradeDate,
      amount: record.amount,
      share: record.share,
      nav: record.nav,
      status: record.status || 'settled',
      txn_id: record.txnId || record.id || '',
      settled_at: record.settledAt || '',
    }).catch(() => {})
  }

  const removeTradeRecordByTxnId = (txnId) => {
    tradeRecords.value = tradeRecords.value.filter(r => r.txnId !== txnId)
    portfolioAPI.deletePendingTrade(txnId).catch(() => {})
  }

  const getLegacyPendingRecord = (txn, fund) => {
    const nav = Number(txn.nav) || getFundNavByDate(fund, txn.tradeDate) || getCurrentPrice(fund)
    return buildTradeRecord(fund, txn.type, Number(txn.inputValue) || 0, nav || 0, txn.tradeDate, 'pending', txn.id)
  }

  const getFundTradeRecords = (fund) => {
    if (!fund?.code) return []
    const records = tradeRecords.value.filter(r => r.fundCode === fund.code)
    const recordedTxnIds = new Set(records.map(r => r.txnId).filter(Boolean))
    const legacyPending = pendingTxns.value
      .filter(txn => txn.fundCode === fund.code && !recordedTxnIds.has(txn.id))
      .map(txn => getLegacyPendingRecord(txn, fund))
    return [...records, ...legacyPending].sort((a, b) => {
      const aTime = a.createdAt || a.tradeDate || ''
      const bTime = b.createdAt || b.tradeDate || ''
      return String(bTime).localeCompare(String(aTime))
    })
  }

  const openHoldingModal = (fund) => {
    holdingModal.value = { open: true, fund }
    tradeForm.value = { type: 'buy', inputValue: '', tradeDate: todayDate.value }
  }

  const openTradeHistory = (fund) => {
    tradeHistoryModal.value = { open: true, fund }
  }

  const closeTradeHistory = () => {
    tradeHistoryModal.value = { open: false, fund: null }
  }

  const openTradeModal = (fund, type) => {
    openHoldingModal(fund)
    tradeForm.value.type = type
  }

  const openEditModal = (fund) => {
    const h = holdings.value[fund.code]
    const currentNav = getCurrentPrice(fund) || parseFloat(fund.dwjz) || 1
    let defaultProfit = 0
    if (h) {
      defaultProfit = getHoldingProfitTotal(fund, holdings.value)
    }
    editForm.value = {
      fund,
      amount: h ? getHoldingAmount(fund, holdings.value).toFixed(2) : '',
      profit: parseFloat(defaultProfit.toFixed(2))
    }
    showEditModal.value = true
  }

  const closeEditModal = () => {
    showEditModal.value = false
    editForm.value = { fund: null, amount: '', profit: 0 }
  }

  const saveEdit = () => {
    const fund = editForm.value.fund
    if (!fund) return
    const amount = parseFloat(editForm.value.amount)
    const profit = parseFloat(editForm.value.profit) || 0
    const nav = parseFloat(fund.dwjz) || getCurrentPrice(fund) || 1
    if (!amount || !nav || nav <= 0) {
      closeEditModal()
      return
    }
    const share = amount / nav
    const newHoldings = { ...holdings.value }
    newHoldings[fund.code] = {
      share,
      cost: nav,
      buy_date: fund.jzrq || todayDate.value,
      profit: parseFloat(profit.toFixed(2)),
      profit_nav_date: getDateText(fund.jzrq) || todayDate.value
    }
    holdings.value = newHoldings
    portfolioAPI.upsertHolding(fund.code, newHoldings[fund.code]).catch(() => {})
    closeEditModal()
  }

  const closeHoldingModal = () => {
    holdingModal.value = { open: false, fund: null }
  }

  const clearHolding = () => {
    const fund = holdingModal.value.fund
    if (!fund) return
    const newHoldings = { ...holdings.value }
    delete newHoldings[fund.code]
    holdings.value = newHoldings
    portfolioAPI.deleteHolding(fund.code).catch(() => {})
    closeHoldingModal()
  }

  const getTradeNav = () => {
    const fund = holdingModal.value.fund
    if (!fund) return 0
    const date = tradeForm.value.tradeDate
    if (!date) return 0
    return getFundNavByDate(fund, date)
  }

  const getTradeResultShares = () => {
    const nav = getTradeNav()
    const inputValue = parseFloat(tradeForm.value.inputValue) || 0
    if (nav <= 0 || inputValue <= 0) return holdings.value[holdingModal.value.fund?.code]?.share || 0
    const currentShares = holdings.value[holdingModal.value.fund?.code]?.share || 0
    if (tradeForm.value.type === 'buy') {
      const tradeShares = inputValue / nav
      return currentShares + tradeShares
    } else {
      return currentShares - inputValue
    }
  }

  const canSubmitTrade = () => {
    const inputValue = parseFloat(tradeForm.value.inputValue)
    if (!inputValue || inputValue <= 0) return false
    if (getTradeNav() <= 0) return false
    if (getTradeResultShares() < 0) return false
    return true
  }

  const submitButtonText = () => {
    const fund = holdingModal.value.fund
    const pending = isTradeDatePending(fund, tradeForm.value.tradeDate)
    const base = tradeForm.value.type === 'buy' ? '加仓' : '减仓'
    return pending ? `确认${base}并挂起` : `确认${base}`
  }

  const isTradeDatePending = (fund, tradeDate) => {
    if (!fund || !tradeDate) return false
    const today = new Date().toISOString().slice(0, 10)
    if (tradeDate !== today) return false
    return !hasExactNavForDate(fund, tradeDate)
  }

  const settleTrade = (fund, type, inputValue, nav, tradeDate, options = {}) => {
    const newHoldings = { ...holdings.value }
    const h = newHoldings[fund.code] || { share: 0, cost: 0, buy_date: '' }

    if (type === 'buy') {
      const tradeShares = inputValue / nav
      const newTotalShares = h.share + tradeShares
      const newAvgCost = h.share > 0
        ? (h.share * h.cost + inputValue) / newTotalShares
        : nav
      newHoldings[fund.code] = {
        share: newTotalShares,
        cost: newAvgCost,
        buy_date: h.buy_date || tradeDate || tradeForm.value.tradeDate,
        profit: h.profit ?? 0,
        profit_nav_date: h.profit_nav_date || getDateText(fund.jzrq) || tradeDate || tradeForm.value.tradeDate
      }
    } else {
      const newTotalShares = h.share - inputValue
      if (newTotalShares <= 0.01) {
        delete newHoldings[fund.code]
      } else {
        newHoldings[fund.code] = {
          share: newTotalShares,
          cost: h.cost,
          buy_date: h.buy_date,
          profit: h.profit ?? 0,
          profit_nav_date: h.profit_nav_date || getDateText(fund.jzrq) || tradeDate || tradeForm.value.tradeDate
        }
      }
    }

    holdings.value = newHoldings

    if (options.record !== false) {
      const record = buildTradeRecord(fund, type, inputValue, nav, tradeDate, 'settled', options.txnId || '')
      if (options.txnId) {
        record.id = options.txnId
      }
      upsertTradeRecord(record)
    }
    portfolioAPI.upsertHolding(fund.code, newHoldings[fund.code] || {
      share: 0, cost: 0, buy_date: '', profit: 0, profit_nav_date: ''
    }).catch(() => {})
  }

  const saveTrade = () => {
    const fund = holdingModal.value.fund
    if (!fund || !canSubmitTrade()) return

    const inputValue = parseFloat(tradeForm.value.inputValue)
    const nav = getTradeNav()
    const tradeDate = tradeForm.value.tradeDate
    const type = tradeForm.value.type

    if (isTradeDatePending(fund, tradeDate)) {
      const txnId = genTxnId()
      const txn = {
        id: txnId,
        fundCode: fund.code,
        fundName: fund.name || fund.code,
        type,
        tradeDate,
        inputValue,
        nav,
        createdAt: new Date().toISOString()
      }
      upsertTradeRecord(buildTradeRecord(fund, type, inputValue, nav, tradeDate, 'pending', txnId))
      pendingTxns.value.push(txn)
      closeHoldingModal()
      return
    }

    settleTrade(fund, type, inputValue, nav, tradeDate)
    closeHoldingModal()
  }

  const cancelPendingTxn = (txnId) => {
    pendingTxns.value = pendingTxns.value.filter(t => t.id !== txnId)
    removeTradeRecordByTxnId(txnId)
  }

  const settlePendingTxnsIfReady = () => {
    if (!pendingTxns.value.length) return
    const remaining = []
    const settledIds = []
    let changed = false

    for (const txn of pendingTxns.value) {
      const fund = funds.value.find(f => f.code === txn.fundCode)
      if (!fund) {
        remaining.push(txn)
        continue
      }
      if (hasExactNavForDate(fund, txn.tradeDate)) {
        const nav = getFundNavByDate(fund, txn.tradeDate)
        if (nav > 0) {
          settleTrade(fund, txn.type, txn.inputValue, nav, txn.tradeDate, { txnId: txn.id })
          settledIds.push(txn.id)
          changed = true
          continue
        }
      }
      remaining.push(txn)
    }

    if (changed) {
      pendingTxns.value = remaining
      if (settledIds.length) {
        portfolioAPI.batchSettleTrades(settledIds).catch(() => {})
      }
    }
  }

  // ==================== Init ====================

  onMounted(async () => {
    try {
      const res = await portfolioAPI.getTrades()
      const data = res?.data
      if (Array.isArray(data) && data.length) {
        const settled = data.filter(r => r.status === 'settled' || r.status !== 'pending')
        const pending = data.filter(r => r.status === 'pending')
        tradeRecords.value = settled.map(r => ({
          id: r.id,
          txnId: r.txn_id || '',
          fundCode: r.fund_code,
          fundName: r.fund_name || r.fund_code,
          type: r.type,
          tradeDate: r.trade_date || '',
          amount: r.amount || 0,
          share: r.share || 0,
          nav: r.nav || 0,
          status: r.status || 'settled',
          createdAt: r.created_at || '',
          settledAt: r.settled_at || '',
        }))
        if (pending.length) {
          pendingTxns.value = pending.map(r => ({
            id: r.txn_id || r.id,
            fundCode: r.fund_code,
            fundName: r.fund_name || r.fund_code,
            type: r.type,
            tradeDate: r.trade_date || '',
            inputValue: r.amount || 0,
            nav: r.nav || 0,
            createdAt: r.created_at || '',
          }))
        }
      }
    } catch { /* API not available */ }
  })

  return {
    holdingModal, tradeForm, pendingTxns, tradeRecords, tradeHistoryModal, showPending,
    showEditModal, editForm,
    upsertTradeRecord, removeTradeRecordByTxnId,
    getFundTradeRecords, getLegacyPendingRecord,
    openHoldingModal, openTradeHistory, closeTradeHistory, openTradeModal,
    openEditModal, closeEditModal, saveEdit, closeHoldingModal, clearHolding,
    getTradeNav, getTradeResultShares, canSubmitTrade, submitButtonText,
    settleTrade, saveTrade, cancelPendingTxn, settlePendingTxnsIfReady,
  }
}
