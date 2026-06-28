<template>
  <div class="market-overview-container">
    <!-- 1. 市场指数实时走势 (置顶 & 折线图) -->
    <div class="market-section" v-if="showSSE30Min">
      <div class="section-header">
        <h3>📉 市场指数实时走势</h3>
        <div class="tab-group">
          <span 
            v-for="tab in tabs" 
            :key="tab.key" 
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            {{ tab.name }}
          </span>
        </div>
        <span class="update-tag" v-if="updateTime">{{ updateTime.split(' ')[1] }} 更新</span>
      </div>
      <div class="chart-container sse-chart-container">
        <v-chart class="chart" :option="currentChartOption" autoresize :theme="echartThemeName" v-if="hasCurrentData" />
        <div v-else class="empty-state">暂无数据 ({{ activeTabName }})</div>
      </div>
    </div>

    <!-- 2. 全球市场指数 (分组展示) -->
    <div class="market-section">
      <div class="section-header">
        <h3>🌍 全球行情</h3>
        <button class="refresh-btn" @click="fetchAll" :disabled="loading">
          <span :class="{ 'spinning': loading }">🔄</span>
        </button>
      </div>

      <!-- 中国市场：A股 + 港股 -->
      <div class="market-sub-section">
        <h4 class="sub-title"><span class="flag">🇨🇳</span> 中国市场 <span class="sub-desc">A股 / 港股</span></h4>
        <div class="index-grid china-grid" v-if="indices.china.length">
          <div v-for="item in indices.china" :key="item.name" class="index-card" :class="getUpDnClass(item.change_pct)">
            <div class="index-name">{{ item.name }}</div>
            <div class="index-price">{{ item.price }}</div>
            <div class="index-change">{{ item.change_pct }}</div>
          </div>
        </div>
      </div>

      <!-- 全球指数 -->
      <div class="market-sub-section">
        <h4 class="sub-title"><span class="flag">🌐</span> 全球指数</h4>
        <div class="index-grid global-grid" v-if="indices.global.length">
          <div v-for="item in indices.global" :key="item.name" class="index-card" :class="getUpDnClass(item.change_pct)">
            <div class="index-name">{{ item.name }}</div>
            <div class="index-price">{{ item.price }}</div>
            <div class="index-change">{{ item.change_pct }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. 近7日A股成交量 (柱状图) -->
    <div class="market-section">
      <div class="section-header">
        <h3>📊 近7日A股成交量</h3>
      </div>
      <div class="chart-container volume-chart-container">
        <v-chart class="chart" :option="volumeOption" autoresize :theme="echartThemeName" v-if="aVolume.length" />
        <div v-else class="empty-state">暂无成交量数据</div>
      </div>
    </div>
    
    <!-- 4. 实时贵金属 (点击查看历史走势) -->
    <div class="market-section">
      <div class="section-header">
        <h3>🥇 实时贵金属</h3>
      </div>
      <div class="gold-grid" v-if="goldRealtime.length">
        <div
          v-for="item in goldRealtime"
          :key="item.name"
          class="gold-card"
          :class="{
            'up': item.change >= 0,
            'down': item.change < 0,
            'clickable': isGoldItem(item)
          }"
          @click="isGoldItem(item) && openGoldHistory(item)"
          :title="isGoldItem(item) ? '点击查看历史走势' : ''"
        >
          <div class="gold-name">
            {{ item.name }}
            <span v-if="isGoldItem(item)" class="chart-hint">📈</span>
          </div>
          <div class="gold-price">{{ item.price }} <span class="unit">{{ item.unit }}</span></div>
          <div class="gold-change">
            <span>{{ item.change >= 0 ? '+' : '' }}{{ item.change }}</span>
            <span class="pct">{{ item.change_pct }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 黄金历史走势弹窗 -->
    <Teleport to="body">
      <div v-if="goldModal.visible" class="gold-modal-overlay" @click.self="closeGoldHistory">
        <div class="gold-modal">
          <div class="gold-modal-header">
            <h3>📈 {{ goldModal.name }} — 近{{ goldDays }}日走势</h3>
            <div class="gold-modal-controls">
              <select v-model="goldDays" class="days-select" @change="fetchGoldHistoryForModal">
                <option :value="7">7天</option>
                <option :value="10">10天</option>
                <option :value="30">30天</option>
              </select>
              <button class="modal-close-btn" @click="closeGoldHistory">✕</button>
            </div>
          </div>
          <div class="gold-modal-body">
            <v-chart v-if="goldChartOption" class="gold-chart" :option="goldChartOption" autoresize :theme="echartThemeName" />
            <div v-else class="empty-state">暂无历史数据</div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { marketAPI } from '../services/api'
import { useEChartsTheme } from '../composables/useEChartsTheme'
import { use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { LineChart, BarChart } from "echarts/charts"
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent } from "echarts/components"
import VChart from "vue-echarts"

use([CanvasRenderer, LineChart, BarChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent])

export default {
  name: 'MarketOverview',
  components: { VChart },
  props: {
    showGoldHistory: { type: Boolean, default: true },
    showSSE30Min: { type: Boolean, default: true },
    autoRefresh: { type: Boolean, default: true },
    refreshInterval: { type: Number, default: 60000 }
  },
  setup(props) {
    const loading = ref(false)
    const marketIndex = ref([])
    const goldRealtime = ref([])
    const goldHistory = ref([])
    const aVolume = ref([])
    const updateTime = ref('')
    let refreshTimer = null

    const { echartThemeName } = useEChartsTheme()

    const cssVar = (name, fallback = '') =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

    const hexToRgba = (hex, alpha) => {
      const clean = hex.replace('#', '')
      const r = parseInt(clean.slice(0, 2), 16)
      const g = parseInt(clean.slice(2, 4), 16)
      const b = parseInt(clean.slice(4, 6), 16)
      return `rgba(${r},${g},${b},${alpha})`
    }

    // ── 黄金弹窗 ──
    const goldModal = ref({ visible: false, name: '', code: '' })
    const goldDays = ref(10)
    const goldModalHistory = ref([])

    const goldChartOption = computed(() => {
      echartThemeName.value; // track theme changes
      const data = goldModalHistory.value
      if (!data.length) return null

      const dates = data.map(i => i.date.slice(5))
      const chinaGold = data.map(i => parseFloat(i.china_gold_price) || null)
      const zhoudafu = data.map(i => parseFloat(i.zhoudafu_price) || null)

      return {
        grid: { top: 20, right: 20, bottom: 30, left: 55, containLabel: false },
        tooltip: {
          trigger: 'axis',
          formatter: (params) => {
            const idx = params[0]?.dataIndex
            if (idx == null) return ''
            const d = data[idx]
            return `<b>${d.date}</b><br/>
              中国黄金: ${d.china_gold_price} (${d.china_gold_change})<br/>
              周大福: ${d.zhoudafu_price} (${d.zhoudafu_change})`
          }
        },
        legend: {
          data: ['中国黄金', '周大福'],
          bottom: 0,
          textStyle: { fontSize: 12 }
        },
        xAxis: {
          type: 'category',
          data: dates,
          axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 },
          axisTick: { show: false }
        },
        yAxis: {
          type: 'value',
          scale: true,
          splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } },
          axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 }
        },
        series: [
          {
            name: '中国黄金',
            data: chinaGold,
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 4,
            lineStyle: { width: 2, color: cssVar('--color-warning', '#faad14') },
            itemStyle: { color: cssVar('--color-warning', '#faad14') }
          },
          {
            name: '周大福',
            data: zhoudafu,
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 4,
            lineStyle: { width: 2, color: cssVar('--color-primary', '#1677ff') },
            itemStyle: { color: cssVar('--color-primary', '#1677ff') }
          }
        ]
      }
    })

    const openGoldHistory = async (item) => {
      goldModal.value = { visible: true, name: item.name, code: item.code || '' }
      document.body.style.overflow = 'hidden'
      await fetchGoldHistoryForModal()
    }

    const closeGoldHistory = () => {
      goldModal.value = { visible: false, name: '', code: '' }
      document.body.style.overflow = ''
    }

    const isGoldItem = (item) => {
      return item.name && (item.name.includes('黄金') || item.name.includes('金'))
    }

    const fetchGoldHistoryForModal = async () => {
      try {
        const res = await marketAPI.getGoldHistory(goldDays.value)
        if (res.data.success) {
          goldModalHistory.value = res.data.data
        }
      } catch (e) {
        console.error('获取黄金历史失败:', e)
      }
    }
    
    // 指数分时数据
    const indicesIntraday = ref({ sh: [], sz: [], hs300: [] })
    const activeTab = ref('sh')
    const tabs = [
      { key: 'sh', name: '上证指数' },
      { key: 'sz', name: '深证成指' },
      { key: 'hs300', name: '沪深300' }
    ]

    const activeTabName = computed(() => tabs.find(t => t.key === activeTab.value)?.name || '')
    const hasCurrentData = computed(() => indicesIntraday.value[activeTab.value]?.length > 0)
    
    // 指数分组
    const indices = computed(() => {
      const all = marketIndex.value
      const chinaNames = ['上证指数','深证成指','创业板指','科创50','沪深300','上证50','中证500','中小100','恒生指数','国企指数','恒生科技']
      const globalNames = ['纳斯达克','纳斯达克100','道琼斯','标普500','日经225','韩国综合','英国富时100','德国DAX','法国CAC40','印度SENSEX']
      return {
        china: all.filter(i => i.market === 'A股' || i.market === '港股' || chinaNames.some(n => i.name.includes(n))),
        global: all.filter(i => i.market === '全球' || i.market === '美股' || globalNames.some(n => i.name.includes(n)))
      }
    })

    // 当前选中的指数图表配置
    const currentChartOption = computed(() => {
      echartThemeName.value; // track theme changes
      const data = indicesIntraday.value[activeTab.value]
      if (!data || !data.length) return {}
      
      const times = data.map(i => i.time)
      const prices = data.map(i => parseFloat(i.price))
      const basePrice = prices[0]
      const isUp = prices[prices.length - 1] >= basePrice
      const lineColor = isUp ? cssVar('--color-danger', '#ff4d4f') : cssVar('--color-success', '#52c41a')

      return {
        grid: { top: 10, right: 10, bottom: 20, left: 50, containLabel: false },
        tooltip: { 
          trigger: 'axis',
          formatter: (params) => {
            const p = params[0]
            if (!p) return ''
            const item = data[p.dataIndex]
            const pctText = item.change_pct && item.change_pct !== '0.00%' ? ` (${item.change_pct})` : ''
            const changeText = item.change && item.change !== '0' && item.change !== '+0' ? `${item.change}${pctText}` : pctText.replace(/[()]/g, '')
            return `
              <div>${item.time}</div>
              <div style="font-weight:bold;color:${lineColor}">${item.price}</div>
              ${changeText ? `<div>${changeText}</div>` : ''}
              <div>量: ${item.volume}</div>
            `
          }
        },
        xAxis: { 
          type: 'category', 
          data: times,
          axisLine: { lineStyle: { color: cssVar('--border-default', '#e5e7eb') } },
          axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 },
          axisTick: { show: false }
        },
        yAxis: { 
          type: 'value', 
          scale: true,
          splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } },
          axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 }
        },
        series: [{
          data: prices,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: lineColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: hexToRgba(lineColor, 0.2) },
                { offset: 1, color: hexToRgba(lineColor, 0) }
              ]
            }
          }
        }]
      }
    })

    // 成交量图表配置
    const volumeOption = computed(() => {
      echartThemeName.value; // track theme changes
      if (!aVolume.value.length) return {}
      
      const dates = aVolume.value.map(i => formatDate(i.date))
      const values = aVolume.value.map(i => parseFloat(i.total.replace('亿', '')))
      
      const barColor = cssVar('--color-primary', '#1677ff')

      return {
        grid: { top: 30, right: 10, bottom: 20, left: 10, containLabel: true },
        tooltip: { 
          trigger: 'axis',
          formatter: (params) => {
            const idx = params[0].dataIndex
            const item = aVolume.value[idx]
            return `
              <b>${item.date}</b><br/>
              总成交: ${item.total}<br/>
              沪: ${item.shanghai}<br/>
              深: ${item.shenzhen}<br/>
              北: ${item.beijing}
            `
          }
        },
        xAxis: { 
          type: 'category', 
          data: dates,
          axisLine: { lineStyle: { color: cssVar('--border-default', '#e5e7eb') } },
          axisTick: { show: false }
        },
        yAxis: { 
          type: 'value',
          splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } }
        },
        series: [{
          data: values,
          type: 'bar',
          barWidth: '40%',
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: barColor },
                { offset: 1, color: hexToRgba(barColor, 0.5) }
              ]
            },
            borderRadius: [4, 4, 0, 0]
          },
          label: {
            show: true,
            position: 'top',
            formatter: '{c}亿',
            color: cssVar('--text-secondary', '#6b7280'),
            fontSize: 10
          }
        }]
      }
    })

    const fetchOverview = async () => {
      const response = await marketAPI.getOverview()
      if (response.data.success) {
        const data = response.data
        if (data.market_index?.success) marketIndex.value = data.market_index.data
        if (data.gold_realtime?.success) goldRealtime.value = data.gold_realtime.data
        if (data.a_volume_7days?.success) aVolume.value = data.a_volume_7days.data.slice().reverse() // 按时间正序
        updateTime.value = data.update_time
      }
    }

    const fetchIntraday = async () => {
      const intradayRes = await marketAPI.getIndicesIntraday()
      if (intradayRes.data.success) {
        indicesIntraday.value = intradayRes.data.data
      }
    }

    const fetchAll = async () => {
      loading.value = true
      try {
        const [overviewResult, intradayResult] = await Promise.allSettled([
          fetchOverview(),
          fetchIntraday()
        ])
        if (overviewResult.status === 'rejected') console.error(overviewResult.reason)
        if (intradayResult.status === 'rejected') console.error(intradayResult.reason)
      } catch (e) {
        console.error(e)
      } finally {
        loading.value = false
      }
    }
    
    const getChangeClass = (change) => {
      if (!change) return ''
      return String(change).startsWith('-') ? 'down' : 'up'
    }

    const getUpDnClass = (pct) => {
      if (!pct) return ''
      const val = parseFloat(pct)
      if (isNaN(val) || val === 0) return ''
      return pct.startsWith('-') ? 'down' : 'up'
    }
    
    const formatDate = (dateStr) => {
      if (!dateStr) return ''
      const parts = dateStr.split('-')
      return parts.length >= 3 ? `${parts[1]}-${parts[2]}` : dateStr
    }

    onMounted(() => {
      fetchAll()
      if (props.autoRefresh) {
        refreshTimer = setInterval(fetchAll, props.refreshInterval)
      }
    })

    onUnmounted(() => {
      if (refreshTimer) clearInterval(refreshTimer)
    })

    return {
      loading, fetchAll,
      marketIndex, indices,
      goldRealtime, goldModal, goldDays, goldModalHistory, goldChartOption,
      openGoldHistory, closeGoldHistory, isGoldItem, fetchGoldHistoryForModal,
      aVolume, updateTime,
      formatDate, getChangeClass, getUpDnClass,
      volumeOption,
      tabs, activeTab, activeTabName, hasCurrentData, currentChartOption,
      echartThemeName
    }
  }
}
</script>

<style scoped>
.market-overview-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.market-section {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 8px;
}

.section-header h3 {
  margin: 0;
  font-size: 1.1em;
  color: var(--text-primary);
}

.tab-group {
  display: flex;
  gap: 8px;
  margin-left: 16px;
  flex: 1;
}

.tab-group span {
  font-size: 0.85em;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  user-select: none;
}

.tab-group span:hover {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.tab-group span.active {
  color: var(--color-primary);
  font-weight: bold;
  background: var(--color-primary-bg);
}

.sse-chart-container {
  height: 200px;
}

.market-sub-section {
  margin-bottom: 16px;
}

.market-sub-section:last-child {
  margin-bottom: 0;
}

.sub-title {
  font-size: 0.95em;
  color: var(--text-secondary);
  margin: 0 0 10px 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sub-desc {
  color: var(--text-tertiary);
  font-size: 0.85em;
  font-weight: normal;
}

.index-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 12px;
}

.china-grid {
  grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
}

.global-grid {
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
}

.index-card {
  padding: 10px;
  border-radius: 8px;
  text-align: center;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  transition: transform 0.2s;
}

.index-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.index-card.up { background: var(--color-danger-bg); border-color: var(--color-danger-border); }
.index-card.down { background: var(--color-success-bg); border-color: var(--color-success-border); }

.index-name { font-size: 0.85em; color: var(--text-secondary); margin-bottom: 4px; }
.index-price { font-weight: bold; font-size: 1.1em; color: var(--text-primary); }
.index-card.up .index-price, .index-card.up .index-change { color: var(--color-danger); }
.index-card.down .index-price, .index-card.down .index-change { color: var(--color-success); }
.index-change { font-size: 0.8em; margin-top: 2px; }

.volume-chart-container {
  height: 220px;
}

.gold-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.gold-card {
  padding: 12px;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 8px;
  text-align: center;
}

.gold-name { font-size: 0.9em; color: var(--text-secondary); margin-bottom: 4px; }
.gold-price { font-weight: bold; font-size: 1.2em; color: var(--color-warning); }
.gold-change { font-size: 0.85em; margin-top: 4px; display: flex; justify-content: center; gap: 6px; }
.gold-change .pct { padding: 0 4px; border-radius: 4px; }
.gold-card.up .pct { background: var(--color-danger-bg); color: var(--color-danger); }
.gold-card.down .pct { background: var(--color-success-bg); color: var(--color-success); }

.gold-modal-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: var(--bg-overlay);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.gold-modal {
  background: var(--bg-elevated); border-radius: 16px;
  width: 100%; max-width: 680px; max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: slideUp 0.25s ease;
}
@keyframes slideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }

.gold-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border-subtle);
}
.gold-modal-header h3 { margin: 0; font-size: 16px; color: var(--text-primary); }

.gold-modal-controls { display: flex; align-items: center; gap: 10px; }

.days-select {
  padding: 4px 10px; border: 1px solid var(--border-default); border-radius: 6px;
  font-size: 12px; background: var(--bg-subtle); color: var(--text-secondary); cursor: pointer;
}

.modal-close-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 8px; background: var(--bg-subtle);
  font-size: 16px; color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
}
.modal-close-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

.gold-modal-body { padding: 20px; flex: 1; min-height: 320px; }
.gold-chart { width: 100%; height: 380px; }

.gold-card.clickable { cursor: pointer; }
.gold-card.clickable:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }

.refresh-btn, .toggle-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-primary);
}

.empty-state {
  text-align: center;
  color: var(--text-tertiary);
  padding: 20px;
  font-size: 0.9em;
}

.chart {
  height: 100%;
  width: 100%;
}

.update-tag {
  font-size: 0.8em;
  color: var(--text-tertiary);
  background: var(--bg-subtle);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
