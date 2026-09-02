// @ts-nocheck
import { ref } from 'vue'
import { onMounted, onUnmounted } from 'vue'
import { useFundRealtimeData } from './useFundRealtimeData'
import { useFundRealtimeTrade } from './useFundRealtimeTrade'
import { useFundRealtimeGroups } from './useFundRealtimeGroups'
import {
  getChangeClass as baseGetChangeClass,
  formatGsz as baseFormatGsz,
  formatChange as baseFormatChange,
  getDateText as baseGetDateText,
  hasFreshEstimate as baseHasFreshEstimate,
  getCurrentPrice as baseGetCurrentPrice,
  getLatestPublishedPrice as baseGetLatestPublishedPrice,
  getPriceStatusLabel as baseGetPriceStatusLabel,
  getPreviousPrice as baseGetPreviousPrice,
  getHoldingCostAmount as baseGetHoldingCostAmount,
  getHoldingEstimatedAmount as baseGetHoldingEstimatedAmount,
  getHoldingProfitToday as baseGetHoldingProfitToday,
  getHoldingProfitTotal as baseGetHoldingProfitTotal,
  getHoldingProfitBeforeFee as baseGetHoldingProfitBeforeFee,
  getHoldingProfitBeforeFeeClass as baseGetHoldingProfitBeforeFeeClass,
  getHoldingFee as baseGetHoldingFee,
  getHoldingReturnRate as baseGetHoldingReturnRate,
  getHoldingReturnRateBeforeFee as baseGetHoldingReturnRateBeforeFee,
  getHoldingProfitTodayClass as baseGetHoldingProfitTodayClass,
  getHoldingProfitTotalClass as baseGetHoldingProfitTotalClass,
  calculateShare as baseCalculateShare,
  formatMoney as baseFormatMoney,
  formatShare as baseFormatShare,
  buildTradeRecord as baseBuildTradeRecord,
  getTradeStatusText as baseGetTradeStatusText,
  genTxnId as baseGenTxnId,
  mapPortfolioHoldings as baseMapPortfolioHoldings,
  mapFundDetailToRealtime as baseMapFundDetailToRealtime,
  parseTrendPoint as baseParseTrendPoint,
  getFundTrendSeries as baseGetFundTrendSeries,
  getFundNavByDate as baseGetFundNavByDate,
  hasExactNavForDate as baseHasExactNavForDate,
  isTradeDatePending as baseIsTradeDatePending,
  getFundSparklinePoints as baseGetFundSparklinePoints,
  getSparklinePath as baseGetSparklinePath,
  getSparklineFill as baseGetSparklineFill,
  getFundSparklinePoints3m as baseGetFundSparklinePoints3m,
  getFundMiniChart3m as baseGetFundMiniChart3m,
  getTrendColorClass3m as baseGetTrendColorClass3m,
  metricBySort as baseMetricBySort,
  getValueClass as baseGetValueClass,
} from './useFundRealtimeBase'

export function useFundRealtime(emit) {
  const groups = useFundRealtimeGroups()
  const data = useFundRealtimeData(emit, {
    portfolioGroups: groups.portfolioGroups,
    fundGroupMap: groups.fundGroupMap,
  })
  const trade = useFundRealtimeTrade(data.funds, data.holdings, data.todayDate, data.refreshMs, {
    refreshHoldings: data.refreshHoldings,
  })

  onMounted(() => {
    document.addEventListener('click', groups.closeContextMenu)
  })

  onUnmounted(() => {
    document.removeEventListener('click', groups.closeContextMenu)
  })

  // Wrapper functions — template calls these with (fund) only,
  // we auto-bind holdings.value so the pure 2-arg signatures still work.
  const getHoldingProfitToday = (fund) => baseGetHoldingProfitToday(fund, data.holdings.value)
  const getHoldingProfitTotal = (fund) => baseGetHoldingProfitTotal(fund, data.holdings.value)
  const getHoldingProfitBeforeFee = (fund) => baseGetHoldingProfitBeforeFee(fund, data.holdings.value)
  const getHoldingProfitBeforeFeeClass = (fund) => baseGetHoldingProfitBeforeFeeClass(fund, data.holdings.value)
  const getHoldingFee = (fund) => baseGetHoldingFee(fund, data.holdings.value)
  const getHoldingEstimatedAmount = (fund) => baseGetHoldingEstimatedAmount(fund, data.holdings.value)
  const getHoldingReturnRate = (fund) => baseGetHoldingReturnRate(fund, data.holdings.value)
  const getHoldingReturnRateBeforeFee = (fund) => baseGetHoldingReturnRateBeforeFee(fund, data.holdings.value)
  const getHoldingProfitTodayClass = (fund) => baseGetHoldingProfitTodayClass(fund, data.holdings.value)
  const getHoldingProfitTotalClass = (fund) => baseGetHoldingProfitTotalClass(fund, data.holdings.value)
  const getHoldingCostAmount = (fund) => baseGetHoldingCostAmount(fund, data.holdings.value)
  const calculateShare = (amount, nav) => baseCalculateShare(amount, nav)
  const formatMoney = (v) => baseFormatMoney(v)
  const formatShare = (v) => baseFormatShare(v)
  const buildTradeRecord = (...args) => baseBuildTradeRecord(...args)
  const getTradeStatusText = (s) => baseGetTradeStatusText(s)
  const genTxnId = () => baseGenTxnId()
  const getChangeClass = (v) => baseGetChangeClass(v)
  const formatGsz = (f) => baseFormatGsz(f)
  const formatChange = (v) => baseFormatChange(v)
  const getDateText = (v) => baseGetDateText(v)
  const hasFreshEstimate = (f) => baseHasFreshEstimate(f)
  const getCurrentPrice = (f) => baseGetCurrentPrice(f)
  const getLatestPublishedPrice = (f) => baseGetLatestPublishedPrice(f)
  const getPriceStatusLabel = (f) => baseGetPriceStatusLabel(f)
  const getPreviousPrice = (f) => baseGetPreviousPrice(f)
  const mapPortfolioHoldings = (p) => baseMapPortfolioHoldings(p)
  const mapFundDetailToRealtime = (d, fc) => baseMapFundDetailToRealtime(d, fc)
  const parseTrendPoint = (i) => baseParseTrendPoint(i)
  const getFundTrendSeries = (f) => baseGetFundTrendSeries(f)
  const getFundNavByDate = (f, d) => baseGetFundNavByDate(f, d)
  const hasExactNavForDate = (f, d) => baseHasExactNavForDate(f, d)
  const isTradeDatePending = (f, d) => baseIsTradeDatePending(f, d)
  const getFundSparklinePoints = (f) => baseGetFundSparklinePoints(f)
  const getSparklinePath = (p) => baseGetSparklinePath(p)
  const getSparklineFill = (p, b) => baseGetSparklineFill(p, b)
  const getFundSparklinePoints3m = (f) => baseGetFundSparklinePoints3m(f)
  const getFundMiniChart3m = (f) => baseGetFundMiniChart3m(f)
  const getTrendColorClass3m = (f) => baseGetTrendColorClass3m(f)
  const metricBySort = (f, k) => baseMetricBySort(f, k)
  const getValueClass = (v) => baseGetValueClass(v)

  const showPortfolioAnalysis = ref(false)

  return {
    ...data,
    ...trade,
    ...groups,
    getChangeClass, formatGsz, formatChange, getDateText, hasFreshEstimate,
    getCurrentPrice, getLatestPublishedPrice, getPriceStatusLabel, getPreviousPrice,
    getHoldingCostAmount, getHoldingEstimatedAmount,
    getHoldingProfitToday, getHoldingProfitTotal, getHoldingProfitBeforeFee, getHoldingProfitBeforeFeeClass, getHoldingFee,
    getHoldingReturnRate, getHoldingReturnRateBeforeFee, getHoldingProfitTodayClass, getHoldingProfitTotalClass,
    calculateShare, formatMoney, formatShare,
    buildTradeRecord, getTradeStatusText, genTxnId,
    mapPortfolioHoldings, mapFundDetailToRealtime, parseTrendPoint,
    getFundTrendSeries, getFundNavByDate, hasExactNavForDate, isTradeDatePending,
    getFundSparklinePoints, getSparklinePath, getSparklineFill,
    getFundSparklinePoints3m, getFundMiniChart3m, getTrendColorClass3m, metricBySort,
    getValueClass, showPortfolioAnalysis,
  }
}
