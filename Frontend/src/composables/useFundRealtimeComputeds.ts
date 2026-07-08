// @ts-nocheck
import Decimal from 'decimal.js'
import { computed } from 'vue'
import { metricBySort, getHoldingEstimatedAmount, getHoldingProfitToday, getHoldingProfitTotal, getHoldingProfitBeforeFee, getHoldingFee, getPreviousPrice, getValueClass } from './useFundRealtimeBase'

export function useFundRealtimeComputeds({
  funds, holdings, fundOrder, sortBy, activeTab,
  portfolioGroups, fundGroupMap
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
    if (activeTab.value === 'dividend') return '暂无匹配"红利低波"主题的基金'
    return '暂无基金'
  })

  const emptyHint = computed(() => {
    if (activeTab.value.startsWith('group_')) return '将基金分配到该分组即可在此查看'
    if (activeTab.value === 'dividend') return '请添加名称包含"红利 / 低波 / 股息"等关键词基金'
    return '点击添加基金后，搜索基金名称或代码即可加入持仓列表'
  })

  const hasHoldings = computed(() => {
    return displayFunds.value.some(f => holdings.value[f.code] && holdings.value[f.code].share)
  })

  const hasDividendFunds = computed(() => {
    return funds.value.some(f => /红利|低波|价值|股息|高股息/.test(f.name || ''))
  })

  const groupRebalanceStatus = computed(() => {
    const result = {}
    for (const group of portfolioGroups.value) {
      if (!group.rebalance_enabled) continue
      const target = group.rebalance_target
      const upper = group.rebalance_upper
      const lower = group.rebalance_lower
      if (!target || !upper || lower === null || lower === undefined) continue

      const groupFunds = funds.value.filter(f => {
        const gid = fundGroupMap.value[f.code]
        return gid !== undefined && gid !== null && String(gid) === String(group.id)
      })
      if (groupFunds.length === 0) continue

      let totalValue = 0
      const fundValues = {}
      for (const f of groupFunds) {
        const val = getHoldingEstimatedAmount(f, holdings.value)
        fundValues[f.code] = val
        totalValue += val
      }
      if (totalValue === 0) continue

      const upperWarnings = []
      const lowerWarnings = []
      for (const f of groupFunds) {
        const ratio = (fundValues[f.code] / totalValue) * 100
        if (ratio >= upper) {
          upperWarnings.push({ fundCode: f.code, fundName: f.name, ratio, threshold: upper, type: 'upper' })
        } else if (ratio <= lower) {
          lowerWarnings.push({ fundCode: f.code, fundName: f.name, ratio, threshold: lower, type: 'lower' })
        }
      }

      if (upperWarnings.length > 0 || lowerWarnings.length > 0) {
        result[group.id] = { upperWarnings, lowerWarnings }
      }
    }
    return result
  })

  const groupRebalanceWarningCount = computed(() => {
    const counts = {}
    for (const [groupId, status] of Object.entries(groupRebalanceStatus.value)) {
      counts[groupId] = status.upperWarnings.length + status.lowerWarnings.length
    }
    return counts
  })

  function rebalanceTooltip(groupId) {
    const status = groupRebalanceStatus.value[groupId]
    if (!status) return ''
    const lines = []
    for (const w of status.upperWarnings) {
      lines.push(`${w.fundName} 超上限 (${w.ratio.toFixed(1)}% > ${w.threshold}%)`)
    }
    for (const w of status.lowerWarnings) {
      lines.push(`${w.fundName} 低于下限 (${w.ratio.toFixed(1)}% < ${w.threshold}%)`)
    }
    return lines.join('\n')
  }

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
    hasHoldings, hasDividendFunds,
    groupRebalanceStatus, groupRebalanceWarningCount, rebalanceTooltip,
    totalAsset, totalProfitToday, totalPreviousAsset, totalProfitTotal,
    totalProfitBeforeFee, totalFee, totalReturnRateBeforeFee,
    totalCost, totalReturnRate, todayReturnRate,
    profitBeforeFeeClass, profitTodayClass, profitTotalClass,
  }
}
