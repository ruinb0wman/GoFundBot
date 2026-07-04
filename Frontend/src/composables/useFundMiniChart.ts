import { onUnmounted, watch, onMounted } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from './useEChartsTheme'

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function cssVar(name: string, fb = ''): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb
}

export function useFundMiniChart() {
  const chartElements: Record<string, HTMLDivElement | null> = {}
  const chartInstances: Record<string, echarts.ECharts> = {}
  const { echartThemeName } = useEChartsTheme()

  function setChartRef(code: string, el: HTMLDivElement | null) {
    chartElements[code] = el
    if (!el && chartInstances[code]) {
      chartInstances[code].dispose()
      delete chartInstances[code]
    }
  }

  function updateChart(code: string, series: { date: string; nav: number }[], trades: any[]) {
    const el = chartElements[code]
    if (!el || series.length < 2) return

    if (!chartInstances[code]) {
      chartInstances[code] = echarts.init(el, echartThemeName.value)
    }
    const instance = chartInstances[code]

    // 3-month window
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 3)
    const cutoffText = cutoff.toISOString().slice(0, 10)
    let windowed = series.filter(p => p.date >= cutoffText)
    if (windowed.length < 2) windowed = series.slice(-24)
    if (windowed.length < 2) return

    const startNav = windowed[0].nav || 1
    const data: [number, number][] = windowed.map(p => [
      new Date(p.date).getTime(),
      ((p.nav - startNav) / startNav) * 100,
    ])
    const trendUp = data[data.length - 1][1] >= data[0][1]

    const upColor = cssVar('--color-danger', '#ff4d4f')
    const downColor = cssVar('--color-success', '#52c41a')
    const textColor = cssVar('--text-tertiary', '#999')
    const splitColor = cssVar('--border-subtle', '#f0f0f0')
    const bgCard = cssVar('--bg-card', '#fff')
    const borderColor = cssVar('--border-default', '#e8e8e8')

    // Build trade lookup + scatter data
    const tradeByDate: Record<string, any> = {}
    const scatterData: any[] = []
    for (const t of trades) {
      tradeByDate[t.tradeDate] = t
    }
    for (const p of windowed) {
      const t = tradeByDate[p.date]
      if (t) {
        scatterData.push({
          value: [new Date(p.date).getTime(), ((p.nav - startNav) / startNav) * 100],
          tradeType: t.type,
          tradeAmount: t.amount || 0,
          tradeNav: t.nav,
          tradeDate: t.tradeDate,
          tradeShare: t.share || 0,
        })
      }
    }

    const option: any = {
      grid: { left: 2, right: 2, top: 6, bottom: 20 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          if (!params?.length) return ''
          const date = echarts.format.formatTime('yyyy-MM-dd', params[0].value[0])
          let html = `<div style="font-weight:600;margin-bottom:2px">${date}</div>`
          for (const p of params) {
            if (p.seriesName === 'trend') {
              const v = p.value[1]
              html += `<div>${v >= 0 ? '+' : ''}${v.toFixed(2)}%</div>`
            }
          }
          const rec = tradeByDate[date]
          if (rec) {
            const label = rec.type === 'buy' ? '买入' : '卖出'
            const color = rec.type === 'buy' ? downColor : upColor
            const amt = rec.type === 'buy'
              ? `¥${(rec.amount || 0).toFixed(2)}`
              : `${(rec.share || 0).toFixed(2)}份`
            html += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid ${splitColor}">`
            html += `<span style="font-weight:700;color:${color}">${label}</span> ${amt}</div>`
            html += `<div style="font-size:11px;color:${textColor}">净值 ${(rec.nav || 0).toFixed(4)}</div>`
          }
          return `<div style="font-size:12px">${html}</div>`
        },
        backgroundColor: bgCard,
        borderColor,
        extraCssText: 'border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.08)',
      },
      xAxis: {
        type: 'time',
        show: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 9, color: textColor, formatter: (v: number) => { const d = new Date(v); return d.getDate() === 1 ? echarts.format.formatTime('MM-dd', v) : '' }, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        show: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 9, color: textColor, formatter: (v: number) => `${v.toFixed(1)}%`, hideOverlap: true },
        splitLine: { lineStyle: { color: splitColor, type: 'dashed' as const } },
        min: (value: any) => value.min - Math.max((value.max - value.min) * 0.2, 0.3),
        max: (value: any) => value.max + Math.max((value.max - value.min) * 0.2, 0.3),
      },
      series: [
        {
          name: 'trend',
          type: 'line',
          data,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1.5, color: trendUp ? upColor : downColor },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: hexToRgba(trendUp ? upColor : downColor, 0.2) },
              { offset: 1, color: hexToRgba(trendUp ? upColor : downColor, 0) },
            ]),
          },
        },
      ],
    }

    if (scatterData.length > 0) {
      option.series.push({
        name: 'trade',
        type: 'scatter',
        data: scatterData,
        symbol: (_v: any, params: any) => params.data?.tradeType === 'sell' ? 'diamond' : 'circle',
        symbolSize: 8,
        itemStyle: {
          color: (p: any) => p.data?.tradeType === 'buy' ? downColor : upColor,
          borderColor: bgCard,
          borderWidth: 1.5,
        },
        z: 3,
      })
    }

    instance.setOption(option, true)
    instance.resize()
  }

  function updateAllCharts(funds: { code: string; trend: { date: string; nav: number }[]; trades: any[] }[]) {
    for (const f of funds) {
      updateChart(f.code, f.trend, f.trades)
    }
  }

  function disposeChart(code: string) {
    if (chartInstances[code]) {
      chartInstances[code].dispose()
      delete chartInstances[code]
    }
    delete chartElements[code]
  }

  const handleResize = () => {
    for (const instance of Object.values(chartInstances)) {
      instance?.resize()
    }
  }

  onMounted(() => window.addEventListener('resize', handleResize))

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    for (const instance of Object.values(chartInstances)) {
      instance.dispose()
    }
  })

  // Watch theme: dispose instances so they get recreated with new theme
  watch(echartThemeName, () => {
    for (const key of Object.keys(chartInstances)) {
      chartInstances[key].dispose()
      delete chartInstances[key]
    }
  })

  return { setChartRef, updateChart, updateAllCharts, disposeChart, echartThemeName }
}
