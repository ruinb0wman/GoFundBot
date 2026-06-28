<template>
  <div class="index-detail">
    <div v-if="loading" class="loading-state">加载中...</div>
    <div v-else-if="error" class="error-state">{{ error }}</div>
    <template v-else-if="detail">
      <div class="detail-header">
        <div class="header-main">
          <h2>{{ detail.name }}</h2>
          <div class="price-section" :class="priceDir">
            <span class="price">{{ detail.price }}</span>
            <span class="change">{{ detail.change_amt >= 0 ? '+' : '' }}{{ detail.change_amt }}</span>
            <span class="pct">{{ detail.change_pct >= 0 ? '+' : '' }}{{ detail.change_pct }}%</span>
          </div>
        </div>
        <div class="header-meta">
          <span class="code">代码: {{ detail.code }}</span>
          <span class="market">{{ detail.market }}</span>
        </div>
      </div>

      <div class="kline-section">
        <div class="kline-header">
          <div class="period-tabs">
            <span v-for="p in periods" :key="p.key" :class="{ active: activePeriod === p.key }" @click="switchPeriod(p.key)">{{ p.label }}</span>
          </div>
        </div>
        <div class="kline-chart">
          <v-chart class="chart" :option="klineOption" autoresize :theme="echartThemeName" v-if="klineData.length" />
          <div v-else class="empty-state">暂无K线数据</div>
        </div>
      </div>

      <div class="stats-section">
        <div class="stat-card"><span class="stat-label">开盘</span><span class="stat-value">{{ detail.open || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">最高</span><span class="stat-value">{{ detail.high || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">最低</span><span class="stat-value">{{ detail.low || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">昨收</span><span class="stat-value">{{ detail.prev_close || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">成交量</span><span class="stat-value">{{ detail.volume || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">成交额</span><span class="stat-value">{{ detail.amount || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">振幅</span><span class="stat-value">{{ detail.amplitude ? detail.amplitude + '%' : '--' }}</span></div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue'
import { marketAPI } from '../services/api'
import { useEChartsTheme } from '../composables/useEChartsTheme'
import { use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { CandlestickChart, BarChart } from "echarts/charts"
import { GridComponent, TooltipComponent, DataZoomComponent } from "echarts/components"
import VChart from "vue-echarts"

use([CanvasRenderer, CandlestickChart, BarChart, GridComponent, TooltipComponent, DataZoomComponent])

export default {
  name: 'IndexDetail',
  components: { VChart },
  props: {
    indexCode: { type: String, required: true }
  },
  setup(props) {
    const loading = ref(true)
    const error = ref('')
    const detail = ref(null)
    const klineData = ref([])
    const activePeriod = ref('daily')
    const periods = [
      { key: 'daily', label: '日K' },
      { key: 'weekly', label: '周K' },
      { key: 'monthly', label: '月K' },
    ]

    const { echartThemeName } = useEChartsTheme()

    const priceDir = computed(() => {
      if (!detail.value) return ''
      const pct = detail.value.change_pct
      if (pct > 0) return 'up'
      if (pct < 0) return 'down'
      return ''
    })

    const cssVar = (name, fallback = '') =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

    const hexToRgba = (hex, alpha) => {
      const clean = hex.replace('#', '')
      const r = parseInt(clean.slice(0, 2), 16)
      const g = parseInt(clean.slice(2, 4), 16)
      const b = parseInt(clean.slice(4, 6), 16)
      return `rgba(${r},${g},${b},${alpha})`
    }

    const klineOption = computed(() => {
      echartThemeName.value
      const data = klineData.value
      if (!data.length) return {}

      const dates = data.map(i => (i.date || i.time || '').slice(5))
      const ohlc = data.map(i => [i.open, i.close, i.low, i.high])
      const volumes = data.map(i => parseFloat(i.volume || 0))
      const ma5 = calcMA(5, data)
      const ma20 = calcMA(20, data)

      const upColor = cssVar('--color-danger', '#ff4d4f')
      const downColor = cssVar('--color-success', '#52c41a')

      return {
        grid: [
          { left: 50, right: 20, top: 10, bottom: 80, height: '55%' },
          { left: 50, right: 20, top: '72%', bottom: 10, height: '20%' }
        ],
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'cross' },
          borderWidth: 1,
          formatter: (params) => {
            const idx = params[0].dataIndex
            const d = data[idx]
            const isUp = d.close >= d.open
            const color = isUp ? upColor : downColor
            return `
              <div style="margin-bottom:4px;font-weight:bold">${d.date || d.time}</div>
              <div>开盘: <b>${d.open}</b></div>
              <div>收盘: <b style="color:${color}">${d.close}</b></div>
              <div>最高: <b>${d.high}</b></div>
              <div>最低: <b>${d.low}</b></div>
              <div>成交量: ${d.volume || 0}</div>
            `
          }
        },
        xAxis: [
          {
            type: 'category',
            data: dates,
            gridIndex: 0,
            axisLabel: { show: false },
            axisLine: { show: false },
            axisTick: { show: false }
          },
          {
            type: 'category',
            data: dates,
            gridIndex: 1,
            axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 },
            axisLine: { lineStyle: { color: cssVar('--border-default', '#e5e7eb') } },
            axisTick: { show: false }
          }
        ],
        yAxis: [
          {
            type: 'value',
            scale: true,
            gridIndex: 0,
            splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } },
            axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 }
          },
          {
            type: 'value',
            gridIndex: 1,
            splitLine: { show: false },
            axisLabel: { show: false }
          }
        ],
        dataZoom: [
          { type: 'inside', xAxisIndex: [0, 1], start: 50, end: 100 },
          { type: 'slider', xAxisIndex: [0, 1], start: 50, end: 100, bottom: 0, height: 20 }
        ],
        series: [
          {
            name: 'K线',
            type: 'candlestick',
            data: ohlc,
            itemStyle: {
              color: upColor,
              color0: downColor,
              borderColor: upColor,
              borderColor0: downColor
            },
            xAxisIndex: 0,
            yAxisIndex: 0
          },
          {
            name: 'MA5',
            type: 'line',
            data: ma5,
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1, color: '#f59e0b' },
            xAxisIndex: 0,
            yAxisIndex: 0
          },
          {
            name: 'MA20',
            type: 'line',
            data: ma20,
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 1, color: '#8b5cf6' },
            xAxisIndex: 0,
            yAxisIndex: 0
          },
          {
            name: '成交量',
            type: 'bar',
            data: volumes.map((v, i) => ({
              value: v,
              itemStyle: {
                color: data[i].close >= data[i].open ? hexToRgba(upColor, 0.5) : hexToRgba(downColor, 0.5)
              }
            })),
            xAxisIndex: 1,
            yAxisIndex: 1
          }
        ]
      }
    })

    const calcMA = (days, data) => {
      const result = []
      for (let i = 0; i < data.length; i++) {
        if (i < days - 1) { result.push('-'); continue }
        let sum = 0
        for (let j = i - days + 1; j <= i; j++) {
          sum += parseFloat(data[j].close || data[j].close)
        }
        result.push(+(sum / days).toFixed(2))
      }
      return result
    }

    const fetchDetail = async () => {
      try {
        const res = await marketAPI.getIndexDetail(props.indexCode)
        if (res.data.success) {
          detail.value = res.data.data
        } else {
          error.value = res.data.error || '获取指数详情失败'
        }
      } catch (e) {
        error.value = '获取指数详情失败: ' + (e.response?.data?.error || e.message)
      }
    }

    const fetchKline = async () => {
      try {
        const res = await marketAPI.getIndexKline(props.indexCode, { period: activePeriod.value })
        if (res.data.success) {
          klineData.value = res.data.data || []
        } else {
          klineData.value = []
        }
      } catch (e) {
        klineData.value = []
      }
    }

    const switchPeriod = (key) => {
      activePeriod.value = key
      fetchKline()
    }

    const loadAll = async () => {
      loading.value = true
      error.value = ''
      await Promise.all([fetchDetail(), fetchKline()])
      loading.value = false
    }

    watch(() => props.indexCode, () => { loadAll() })

    onMounted(() => { loadAll() })

    return {
      loading, error, detail,
      klineData, activePeriod, periods,
      klineOption, echartThemeName,
      priceDir, switchPeriod
    }
  }
}
</script>

<style scoped>
.index-detail {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-md);
}

.loading-state, .error-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
  font-size: 1.1em;
}

.error-state {
  color: var(--color-danger);
}

.detail-header {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.header-main h2 {
  margin: 0 0 8px 0;
  font-size: 1.5em;
  color: var(--text-primary);
}

.price-section {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.price-section .price {
  font-size: 2em;
  font-weight: 700;
}

.price-section .change {
  font-size: 1.1em;
  font-weight: 500;
}

.price-section .pct {
  font-size: 1em;
  font-weight: 500;
}

.price-section.up { color: var(--color-danger); }
.price-section.down { color: var(--color-success); }

.header-meta {
  margin-top: 8px;
  display: flex;
  gap: 16px;
  font-size: 0.85em;
  color: var(--text-tertiary);
}

.kline-section {
  margin-bottom: 24px;
}

.kline-header {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.period-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-subtle);
  padding: 3px;
  border-radius: var(--radius-sm);
}

.period-tabs span {
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 0.9em;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.period-tabs span:hover {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.period-tabs span.active {
  color: var(--color-primary);
  font-weight: 600;
  background: var(--color-primary-bg);
}

.kline-chart {
  height: 440px;
}

.chart {
  height: 100%;
  width: 100%;
}

.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-tertiary);
  font-size: 1em;
}

.stats-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}

.stat-card {
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.stat-label {
  display: block;
  font-size: 0.8em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 1.05em;
  font-weight: 600;
  color: var(--text-primary);
}
</style>
