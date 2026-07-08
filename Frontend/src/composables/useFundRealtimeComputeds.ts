// @ts-nocheck
import Decimal from 'decimal.js'
import { computed } from 'vue'
import { metricBySort, getHoldingEstimatedAmount, getHoldingProfitToday, getHoldingProfitTotal, getHoldingProfitBeforeFee, getHoldingFee, getPreviousPrice, getValueClass } from './useFundRealtimeBase'

export function useFundRealtimeComputeds({
  funds, holdings, fundOrder, sortBy, activeTab,
  portfolioGroups, fundGroupMap, rebalanceThreshold
}) {
  const isTradingTime = computed(() => {
    const now = new Date()
    const day = now.getDay()
    if (day === 0 || day === 6) return false
    const h = now.getHours()
    const m = now.getMinutes()
    const minutes = h * 60 + m
    return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900)
  })

  const sortedFunds = computed(() => {
    const orderMap = {}
    fundOrder.value.forEach((code, i) => { orderMap[code] = i })
    funds.value.forEach(f => { if (!(f.code in orderMap)) orderMap[f.code] = Infinity })
    const list = [...funds.value]
    list.sort((a, b) => {
      const orderDiff = orderMap[a.code] - orderMap[b.code]
      if (orderDiff !== 0) return orderDiff
      const aVal = metricBySort(a, sortBy.value)
      const bVal = metricBySort(b, sortBy.value)
      if (sortBy.value === 'todayProfitAsc') return aVal - bVal
      return bVal - aVal
    })
    return list
  })

  const displayFunds = computed(() => {
    if (activeTab.value === 'all') return sortedFunds.value
    if (activeTab.value.startsWith('group_')) {
      const groupId = activeTab.value.replace('group_', '')
      return sortedFunds.value.filter(f => fundGroupMap.value[f.code] === groupId)
    }
    if (activeTab.value === 'rebalance') {
      return sortedFunds.value.filter(f => {
        const h = holdings.value[f.code]
        if (!h || !h.share) return false
        const amount = getHoldingEstimatedAmount(f, holdings.value)
        if (!amount) return false
        const diffRatio = Math.abs(getHoldingProfitTotal(f, holdings.value) / amount)
        return diffRatio >= rebalanceThreshold.value / 100
      })
    }
    if (activeTab.value === 'dividend') {
      return sortedFunds.value.filter(f => /红利|低波|价值|股息|高股息/.test(f.name || ''))
    }
    return sortedFunds.value
  })

  const emptyTitle = computed(() => {
    if (activeTab.value.startsWith('group_')) {
      const g = portfolioGroups.value.find(g => 'group_' + g.id === activeTab.value)
      return g ? `"${g.name}" 分组暂无基金` : '暂无基金'
    }
    if (activeTab.value === 'rebalance') return '暂无需要再平衡的基金'
    if (activeTab.value === 'dividend') return '暂无匹配"红利低波"主题的基金'
    return '暂无基金'
  })

  const emptyHint = computed(() => {
    if (activeTab.value.startsWith('group_')) return '将基金分配到该分组即可在此查看'
    if (activeTab.value === 'rebalance') return `当前持仓波动处于 ±${rebalanceThreshold.value}% 以内`
    if (activeTab.value === 'dividend') return '请添加名称包含"红利 / 低波 / 股息"等关键词基金'
    return '点击添加基金后，搜索基金名称或代码即可加入持仓列表'
  })

  const hasHoldings = computed(() => {
    return displayFunds.value.some(f => holdings.value[f.code] && holdings.value[f.code].share)
  })

  const hasRebalanceFunds = computed(() => {
    return funds.value.some(f => {
      const h = holdings.value[f.code]
      if (!h || !h.share) return false
      const amount = getHoldingEstimatedAmount(f, holdings.value)
      if (!amount) return false
      return Math.abs(getHoldingProfitTotal(f, holdings.value) / amount) >= rebalanceThreshold.value / 100
    })
  })

  const hasDividendFunds = computed(() => {
    return funds.value.some(f => /红利|低波|价值|股息|高股息/.test(f.name || ''))
  })

  const totalAsset = computed(() => {
    const scope = displayFunds.value
    let total = 0
    scope.forEach(fund => {
      const h = holdings.value[fund.code]
      if (h && h.share) {
        total += getHoldingEstimatedAmount(fund, holdings.value)
      }
    })
    return total
  })

  const totalProfitToday = computed(() => {
    const scope = displayFunds.value
    let total = 0
    scope.forEach(fund => {
      const h = holdings.value[fund.code]
      if (h && h.share) {
        total += getHoldingProfitToday(fund, holdings.value)
      }
    })
    return total
  })

  const totalPreviousAsset = computed(() => {
    const scope = displayFunds.value
    let total = 0
    scope.forEach(fund => {
      const h = holdings.value[fund.code]
      if (h && h.share) {
        total += h.share * getPreviousPrice(fund)
      }
    })
    return total
  })

  const totalProfitTotal = computed(() => {
    const scope = displayFunds.value
    let total = 0
    scope.forEach(fund => {
      const h = holdings.value[fund.code]
      if (h && h.share && h.cost) {
        total += getHoldingProfitTotal(fund, holdings.value)
      }
    })
    return total
  })

  const totalCost = computed(() => {
    const scope = displayFunds.value
    let total = 0
    scope.forEach(fund => {
      const h = holdings.value[fund.code]
      if (h && h.share && h.cost) {
        total += h.share * h.cost
      }
    })
    return total
  })

  const totalReturnRate = computed(() => {
    if (totalCost.value === 0) return 0
    return new Decimal(totalProfitTotal.value).div(totalCost.value).mul(100).toNumber()
  })

  const todayReturnRate = computed(() => {
    if (!totalPreviousAsset.value) return 0
    return new Decimal(totalProfitToday.value).div(totalPreviousAsset.value).mul(100).toNumber()
  })

  const totalProfitBeforeFee = computed(() => {
    const scope = displayFunds.value
    let total = 0
    scope.forEach(fund => {
      const h = holdings.value[fund.code]
      if (h && h.share && h.cost) {
        total += getHoldingProfitBeforeFee(fund, holdings.value)
      }
    })
    return total
  })

  const totalFee = computed(() => {
    const scope = displayFunds.value
    let total = 0
    scope.forEach(fund => {
      total += getHoldingFee(fund, holdings.value)
    })
    return total
  })

  const totalReturnRateBeforeFee = computed(() => {
    if (totalCost.value === 0) return 0
    return new Decimal(totalProfitBeforeFee.value).div(totalCost.value).mul(100).toNumber()
  })

  const profitBeforeFeeClass = computed(() => getValueClass(totalProfitBeforeFee.value))
  const profitTodayClass = computed(() => getValueClass(totalProfitToday.value))
  const profitTotalClass = computed(() => getValueClass(totalProfitTotal.value))

  return {
    isTradingTime, sortedFunds, displayFunds, emptyTitle, emptyHint,
    hasHoldings, hasRebalanceFunds, hasDividendFunds,
    totalAsset, totalProfitToday, totalPreviousAsset, totalProfitTotal,
    totalProfitBeforeFee, totalFee, totalReturnRateBeforeFee,
    totalCost, totalReturnRate, todayReturnRate,
    profitBeforeFeeClass, profitTodayClass, profitTotalClass,
  }
}
