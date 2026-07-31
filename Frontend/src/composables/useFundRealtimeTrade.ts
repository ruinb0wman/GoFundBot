// @ts-nocheck
import { ref, onMounted, watch } from 'vue'
import { portfolioAPI } from '../services/portfolioApi'
import {
  getFundNavByDate, getCurrentPrice, getDateText, hasExactNavForDate,
  getHoldingProfitTotal, hasFreshEstimate,
  getFundTrendSeries, buildTradeRecord, genTxnId,
} from './useFundRealtimeBase'
import type { RealtimeFund, RealtimeHolding, PendingTxn, RealtimeTradeRecord } from '../types'

export function useFundRealtimeTrade(funds, holdings, todayDate, refreshMs, extra = {}) {
  const { refreshHoldings } = extra
  const holdingModal = ref<{ open: boolean; fund: RealtimeFund | null }>({ open: false, fund: null })
  const tradeForm = ref<{ type: 'buy' | 'sell'; inputValue: string; tradeDate: string }>({ type: 'buy', inputValue: '', tradeDate: todayDate.value })
  const pendingTxns = ref<PendingTxn[]>([])
  const tradeRecords = ref<RealtimeTradeRecord[]>([])
  const tradeHistoryModal = ref<{ open: boolean; fund: RealtimeFund | null }>({ open: false, fund: null })
  const adjustmentModal = ref<{ open: boolean; fund: RealtimeFund | null }>({ open: false, fund: null })
  const adjustmentForm = ref<{ tradeDate: string; amount: string; note: string; subtype: string; share: string }>({ tradeDate: todayDate.value, amount: '', note: '', subtype: 'fee', share: '' })
  const showPending = ref(false)

  const upsertTradeRecord = (record) => {
    const idx = tradeRecords.value.findIndex(r => r.id === record.id || (record.txnId && r.txnId === record.txnId))
    if (idx >= 0) {
      const next = [...tradeRecords.value]
      const existing = next[idx]
      next[idx] = { ...existing, ...record }
      tradeRecords.value = next
      if (existing.dbId) {
        portfolioAPI.updateTrade(existing.dbId, {
          status: record.status,
          settled_at: record.settledAt || '',
        }).catch(() => {})
      }
    } else {
      tradeRecords.value = [record, ...tradeRecords.value]
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
      }).then(res => {
        if (res?.data?.id) record.dbId = res.data.id
      }).catch(() => {})
    }
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

  const openAdjustmentModal = (fund) => {
    adjustmentModal.value = { open: true, fund }
    adjustmentForm.value = { tradeDate: todayDate.value, amount: '', note: '', subtype: 'fee', share: '' }
  }

  const closeAdjustmentModal = () => {
    adjustmentModal.value = { open: false, fund: null }
  }

  const saveAdjustment = () => {
    const fund = adjustmentModal.value.fund
    if (!fund) return
    const amount = parseFloat(adjustmentForm.value.amount)
    if (!amount || amount <= 0) return
    const subtype = adjustmentForm.value.subtype || 'fee'
    const txnId = genTxnId()
    const record = {
      id: txnId,
      txnId,
      fundCode: fund.code,
      fundName: fund.name || fund.code,
      type: subtype,
      tradeDate: adjustmentForm.value.tradeDate,
      amount,
      share: 0,
      nav: 0,
      status: 'settled',
      createdAt: new Date().toISOString(),
      settledAt: new Date().toISOString(),
      note: adjustmentForm.value.note || '',
    }
    if (subtype === 'dividend') {
      const share = parseFloat(adjustmentForm.value.share)
      if (share > 0) {
        record.share = share
        record.nav = amount / share
      }
    }
    upsertTradeRecord(record)
    closeAdjustmentModal()
    if (typeof refreshHoldings === 'function') refreshHoldings()
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

  watch(funds, settlePendingTxnsIfReady)

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
            inputValue: r.type === 'sell' ? (r.share || 0) : (r.amount || 0),
            nav: r.nav || 0,
            createdAt: r.created_at || '',
          }))
        }
      }
    } catch { /* API not available */ }
    settlePendingTxnsIfReady()
  })

  return {
    holdingModal, tradeForm, pendingTxns, tradeRecords, tradeHistoryModal, showPending,
    adjustmentModal, adjustmentForm,
    upsertTradeRecord, removeTradeRecordByTxnId,
    getFundTradeRecords, getLegacyPendingRecord,
    openHoldingModal, openTradeHistory, closeTradeHistory, openTradeModal,
    openAdjustmentModal, closeAdjustmentModal, saveAdjustment,
    closeHoldingModal, clearHolding,
    getTradeNav, getTradeResultShares, canSubmitTrade, submitButtonText,
    settleTrade, saveTrade, cancelPendingTxn, settlePendingTxnsIfReady,
  }
}
