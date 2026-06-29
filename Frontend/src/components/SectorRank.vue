<!-- 行业板块排行组件 -->
<template>
  <div class="sector-rank-container">
    <div class="section-header">
      <h3><LucideIcon name="Factory" :size="20" /> 行业板块排行</h3>
      <button class="refresh-btn" @click="fetchSectors" :disabled="loading" title="刷新板块数据">
        <span :class="{ 'spinning': loading }"><LucideIcon name="RefreshCw" :size="16" /></span>
      </button>
      <button
        class="expand-btn"
        @click="openSectorModal()"
        :disabled="!sectors.length"
        title="放大查看板块排行"
      >
        <LucideIcon name="Maximize2" :size="16" />
      </button>
    </div>
    <div class="filter-panel">
      <div class="market-stats" v-if="sectors.length">
        <span class="stat-chip total">{{ isFromCache ? '缓存数据' : '实时数据' }} {{ sectors.length }}</span>
        <span class="stat-chip up">上涨 {{ upCount }}</span>
        <span class="stat-chip flat">平盘 {{ flatCount }}</span>
        <span class="stat-chip down">下跌 {{ downCount }}</span>
      </div>
    </div>

    <div v-if="loading && !sectors.length" class="loading-state">
      <span class="loading-spinner"></span>
      <span>加载中...</span>
    </div>

    <div v-else-if="error" class="error-state">
      <span>{{ error }}</span>
      <button @click="fetchSectors">重试</button>
    </div>

    <div v-else class="sector-content">
      <!-- 涨跌分布概览 -->
      <div class="overview-bar" v-if="sectors.length">
        <div class="bar-section up" :style="{ width: upPercent + '%' }">
          <span v-if="upCount">{{ upCount }}</span>
        </div>
        <div class="bar-section flat" :style="{ width: flatPercent + '%' }">
          <span v-if="flatCount">{{ flatCount }}</span>
        </div>
        <div class="bar-section down" :style="{ width: downPercent + '%' }">
          <span v-if="downCount">{{ downCount }}</span>
        </div>
      </div>

      <!-- 板块列表 -->
      <div class="sector-list">
        <div
          v-for="(sector, index) in displayedSectors"
          :key="sector.name"
          class="sector-item"
          :class="{
            'up': sector.raw_change > 0,
            'down': sector.raw_change < 0
          }"
          @click="openSectorModal(sector)"
        >
          <div class="sector-rank">{{ pageStart + index + 1 }}</div>
          <div class="sector-info">
            <div class="sector-name">{{ sector.name }}</div>
            <div class="sector-flow">
              <span class="label">主力:</span>
              <span :class="getFlowClass(sector.main_inflow)">{{ sector.main_inflow }}</span>
            </div>
          </div>
          <div class="sector-change" :class="{ 'up': sector.raw_change > 0, 'down': sector.raw_change < 0 }">
            {{ sector.change_pct }}
          </div>
        </div>
      </div>

      <div v-if="!displayedSectors.length" class="empty-filter">没有匹配的板块</div>

      <div v-if="filteredSectors.length > pageSize" class="pagination">
        <button class="page-btn" @click="currentPage = 1" :disabled="currentPage === 1">首页</button>
        <button class="page-btn" @click="currentPage -= 1" :disabled="currentPage === 1">上一页</button>
        <span class="page-info">第 {{ currentPage }} / {{ totalPages }} 页</span>
        <button class="page-btn" @click="currentPage += 1" :disabled="currentPage === totalPages">下一页</button>
      </div>
    </div>

    <div v-if="updateTime" class="update-time">
      <span v-if="isFromCache" class="data-source-badge stale" title="数据来自本地缓存，非实时行情">
        <LucideIcon name="Package" :size="14" /> 本地缓存
      </span>
      <span v-if="dataDate" class="data-date" title="数据对应的交易日">
        <LucideIcon v-if="isStale" name="Calendar" :size="14" /> {{ dataDate }}
      </span>
      <span class="last-refresh">上次刷新 {{ updateTime.slice(-8) }}</span>
    </div>

    <Teleport to="body">
      <div v-if="modalVisible" class="sector-modal-overlay" @click.self="closeSectorModal">
        <div class="sector-modal">
          <div class="modal-header">
            <div>
              <h3>行业板块排行</h3>
              <p>
                {{ dataDate || '最新数据' }}
                <span>上涨 {{ upCount }}</span>
                <span>下跌 {{ downCount }}</span>
                <span>共 {{ filteredSectors.length }} 个</span>
              </p>
            </div>
            <button class="modal-close" @click="closeSectorModal">×</button>
          </div>

          <div class="modal-filters">
            <SearchBar
              v-model.trim="keyword"
              placeholder="搜索板块名称或代码..."
              compact
              size="sm"
            />
            <div class="filter-row">
              <select v-model="sortBy" class="sort-select">
                <option value="change_desc">涨跌幅 ↓</option>
                <option value="change_asc">涨跌幅 ↑</option>
                <option value="inflow_desc">主力净流入 ↓</option>
                <option value="inflow_asc">主力净流入 ↑</option>
                <option value="name">按名称</option>
              </select>
              <select v-model="changeFilter" class="sort-select">
                <option value="all">全部涨跌</option>
                <option value="up">上涨</option>
                <option value="down">下跌</option>
                <option value="flat">平盘</option>
              </select>
              <select v-model="flowFilter" class="sort-select">
                <option value="all">全部资金</option>
                <option value="inflow">主力流入</option>
                <option value="outflow">主力流出</option>
              </select>
            </div>
            <div class="market-stats" v-if="sectors.length">
              <span class="stat-chip total">{{ isFromCache ? '缓存数据' : '实时数据' }} {{ sectors.length }}</span>
              <span class="stat-chip up">上涨 {{ upCount }}</span>
              <span class="stat-chip flat">平盘 {{ flatCount }}</span>
              <span class="stat-chip down">下跌 {{ downCount }}</span>
            </div>
          </div>

          <div class="modal-overview overview-bar" v-if="sectors.length">
            <div class="bar-section up" :style="{ width: upPercent + '%' }">
              <span v-if="upCount">{{ upCount }}</span>
            </div>
            <div class="bar-section flat" :style="{ width: flatPercent + '%' }">
              <span v-if="flatCount">{{ flatCount }}</span>
            </div>
            <div class="bar-section down" :style="{ width: downPercent + '%' }">
              <span v-if="downCount">{{ downCount }}</span>
            </div>
          </div>

          <div class="modal-sector-list">
            <div
              v-for="(sector, index) in filteredSectors"
              :key="`modal-${sector.name}`"
              class="modal-sector-item"
              :class="{
                up: sector.raw_change > 0,
                down: sector.raw_change < 0,
                selected: selectedSector?.name === sector.name
              }"
            >
              <div class="modal-rank">{{ index + 1 }}</div>
              <div class="modal-sector-main">
                <div class="modal-sector-name">{{ sector.name }}</div>
                <div class="modal-sector-flow">
                  主力净流入 <span :class="getFlowClass(sector.main_inflow)">{{ sector.main_inflow }}</span>
                </div>
              </div>
              <div class="modal-sector-change" :class="{ up: sector.raw_change > 0, down: sector.raw_change < 0 }">
                {{ sector.change_pct }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { marketAPI } from '../services/api'

const props = withDefaults(defineProps<{ limit?: number; autoRefresh?: boolean; refreshInterval?: number }>(), { limit: 90, autoRefresh: true, refreshInterval: 300000 })

const sectors = ref<any[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const updateTime = ref('')
const dataDate = ref('')
const isStale = ref(false)
const isPartial = ref(false)
const dataSource = ref('')
const keyword = ref('')
const sortBy = ref('change_desc')
const changeFilter = ref('all')
const flowFilter = ref('all')
const modalVisible = ref(false)
const selectedSector = ref<any>(null)
const pageSize = 20
const currentPage = ref(1)
let refreshTimer: ReturnType<typeof setInterval> | null = null

const fetchSectors = async () => {
  loading.value = true
  error.value = null

  try {
    const response = await marketAPI.getSectorRank(props.limit)
    if (response.data.success && response.data.data?.length) {
      applySectorData(response.data.data, {
        update_time: response.data.update_time,
        data_date: response.data.data_date || '',
        is_stale: !!response.data.is_stale,
        is_partial: !!response.data.is_partial,
        source: response.data.source || 'backend'
      })
      return
    }

    if (response.data.data?.length) {
      applySectorData(response.data.data, {
        update_time: response.data.update_time || '',
        data_date: response.data.data_date || '',
        is_stale: !!response.data.is_stale,
        is_partial: true,
        source: 'backend_partial'
      })
      return
    }

    clearSectorData()
    error.value = response.data.error || '外部行情源暂不可用，暂无可展示的板块排行'
  } catch (e) {
    clearSectorData()
    error.value = '外部行情源连接失败，请稍后重试'
    console.error('获取板块排行失败:', e)
  } finally {
    loading.value = false
  }
}

const applySectorData = (rows: any[], meta: any = {}) => {
  sectors.value = rows
  updateTime.value = meta.update_time || ''
  dataDate.value = meta.data_date || ''
  isStale.value = !!meta.is_stale
  isPartial.value = !!meta.is_partial
  dataSource.value = meta.source || ''
  currentPage.value = 1
}

const clearSectorData = () => {
  sectors.value = []
  updateTime.value = ''
  dataDate.value = ''
  isStale.value = false
  isPartial.value = false
  dataSource.value = ''
  currentPage.value = 1
}

const isFromCache = computed(() => {
  return dataSource.value === 'file_cache' || dataSource.value === 'stale_cache'
})

const filteredSectors = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  let result = sectors.value.filter((sector: any) => {
    if (q && !String(sector.name || '').toLowerCase().includes(q)) return false
    if (changeFilter.value === 'up' && !(sector.raw_change > 0)) return false
    if (changeFilter.value === 'down' && !(sector.raw_change < 0)) return false
    if (changeFilter.value === 'flat' && sector.raw_change !== 0) return false
    if (flowFilter.value === 'inflow' && !(sector.raw_main_inflow > 0)) return false
    if (flowFilter.value === 'outflow' && !(sector.raw_main_inflow < 0)) return false
    return true
  })

  const sortFn: Record<string, (a: any, b: any) => number> = {
    change_desc: (a, b) => b.raw_change - a.raw_change,
    change_asc:  (a, b) => a.raw_change - b.raw_change,
    inflow_desc: (a, b) => b.raw_main_inflow - a.raw_main_inflow,
    inflow_asc:  (a, b) => a.raw_main_inflow - b.raw_main_inflow,
    name: (a, b) => String(a.name).localeCompare(String(b.name), 'zh'),
  }
  const fn = sortFn[sortBy.value] || sortFn.change_desc
  return result.sort(fn)
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredSectors.value.length / pageSize)))
const pageStart = computed(() => (currentPage.value - 1) * pageSize)
const displayedSectors = computed(() => {
  return filteredSectors.value.slice(pageStart.value, pageStart.value + pageSize)
})

const upCount = computed(() => sectors.value.filter((s: any) => s.raw_change > 0).length)
const downCount = computed(() => sectors.value.filter((s: any) => s.raw_change < 0).length)
const flatCount = computed(() => sectors.value.filter((s: any) => s.raw_change === 0).length)
const total = computed(() => sectors.value.length || 1)

const upPercent = computed(() => (upCount.value / total.value) * 100)
const downPercent = computed(() => (downCount.value / total.value) * 100)
const flatPercent = computed(() => (flatCount.value / total.value) * 100)

const getFlowClass = (flow: string) => {
  if (!flow) return ''
  if (flow.startsWith('-')) return 'outflow'
  return 'inflow'
}

const openSectorModal = (sector: any = null) => {
  selectedSector.value = sector
  modalVisible.value = true
}

const closeSectorModal = () => {
  modalVisible.value = false
  selectedSector.value = null
}

watch([keyword, sortBy, changeFilter, flowFilter], () => {
  currentPage.value = 1
})

watch(totalPages, (pages: number) => {
  if (currentPage.value > pages) currentPage.value = pages
})

onMounted(() => {
  fetchSectors()
  if (props.autoRefresh) {
    refreshTimer = setInterval(fetchSectors, props.refreshInterval)
  }
})

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }
})
</script>

<style scoped>
.sector-rank-container {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-default);
}

.section-header h3 {
  flex-shrink: 0;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.filter-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}

.filter-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.sort-select {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  font-size: 12px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
}

.market-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.stat-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.stat-chip.total {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.stat-chip.up {
  color: var(--color-danger);
  background: var(--color-danger-bg);
}

.stat-chip.flat {
  color: var(--text-secondary);
  background: var(--bg-subtle);
}

.stat-chip.down {
  color: var(--color-success);
  background: var(--color-success-bg);
}

.stat-chip.page {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-left: auto;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  cursor: pointer;
  font-size: 16px;
  border-radius: 8px;
  transition: all 0.2s;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.refresh-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.refresh-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  transition: all 0.2s;
  flex-shrink: 0;
}

.expand-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.expand-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.spinning {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.overview-bar {
  display: flex;
  height: 28px;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
  background: var(--bg-subtle);
}

.bar-section {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-inverse);
  transition: width 0.3s;
}

.bar-section.up {
  background: var(--color-danger);
}

.bar-section.flat {
  background: var(--text-tertiary);
}

.bar-section.down {
  background: var(--color-success);
}

.sector-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: none;
  overflow: visible;
  padding-right: 4px;
}

.sector-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-subtle);
  border-radius: 8px;
  transition: all 0.2s;
  border-left: 3px solid transparent;
  cursor: pointer;
}

.sector-item:hover {
  background: var(--bg-hover);
}

.sector-item.up {
  border-left-color: var(--color-danger);
  background: var(--color-danger-bg);
}

.sector-item.down {
  border-left-color: var(--color-success);
  background: var(--color-success-bg);
}

.sector-rank {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-right: 12px;
}

.sector-item:nth-child(1) .sector-rank {
  background: #ffd700;
  color: #fff;
}

.sector-item:nth-child(2) .sector-rank {
  background: #c0c0c0;
  color: #fff;
}

.sector-item:nth-child(3) .sector-rank {
  background: #cd7f32;
  color: #fff;
}

.sector-info {
  flex: 1;
}

.sector-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.sector-flow {
  font-size: 12px;
  color: var(--text-secondary);
}

.sector-flow .label {
  margin-right: 4px;
}

.sector-flow .inflow {
  color: var(--color-danger);
}

.sector-flow .outflow {
  color: var(--color-success);
}

.sector-flow .pct {
  margin-left: 4px;
  color: var(--text-tertiary);
}

.sector-change {
  font-size: 16px;
  font-weight: 600;
  min-width: 70px;
  text-align: right;
}

.sector-change.up {
  color: var(--color-danger);
}

.sector-change.down {
  color: var(--color-success);
}

.empty-filter {
  margin-top: 12px;
  padding: 28px 12px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
  background: var(--bg-subtle);
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
}

.page-btn {
  min-width: 64px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.page-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.page-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.page-info {
  min-width: 92px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-default);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 8px;
}

.error-state button {
  margin-top: 12px;
  padding: 6px 16px;
  background: var(--color-primary);
  color: var(--text-inverse);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.update-time {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-tertiary);
}

.data-source-badge {
  padding: 1px 8px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 11px;
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.data-source-badge.stale {
  background: var(--color-primary-bg);
  color: var(--color-primary);
}

.data-date {
  color: var(--color-primary);
  background: var(--color-primary-bg);
  padding: 1px 6px;
  border-radius: 4px;
}

.last-refresh {
  color: var(--text-tertiary);
}

.sector-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--bg-overlay);
  backdrop-filter: blur(4px);
}

.sector-modal {
  width: min(920px, 94vw);
  height: min(760px, 88vh);
  display: flex;
  flex-direction: column;
  padding: 20px;
  border-radius: 12px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-default);
}

.modal-header h3 {
  margin: 0 0 6px;
  font-size: 20px;
  color: var(--text-primary);
}

.modal-header p {
  margin: 0;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text-secondary);
}

.modal-close {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: var(--bg-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}

.modal-close:hover {
  background: var(--bg-hover);
}

.modal-overview {
  flex-shrink: 0;
  margin: 16px 0;
}

.modal-sector-list {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  overflow-y: auto;
  padding-right: 6px;
}

.modal-sector-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 62px;
  padding: 12px;
  border: 1px solid transparent;
  border-left: 4px solid transparent;
  border-radius: var(--radius-md);
  background: var(--bg-primary);
}

.modal-sector-item.up {
  border-left-color: var(--color-danger);
  background: var(--color-danger-bg);
}

.modal-sector-item.down {
  border-left-color: var(--color-success);
  background: var(--color-success-bg);
}

.modal-sector-item.selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.12);
}

.modal-rank {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-weight: 700;
}

.modal-sector-main {
  min-width: 0;
  flex: 1;
}

.modal-sector-name {
  margin-bottom: 4px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
}

.modal-sector-flow {
  color: var(--text-secondary);
  font-size: 12px;
}

.modal-sector-flow .inflow {
  color: var(--color-danger);
  font-weight: 700;
}

.modal-sector-flow .outflow {
  color: var(--color-success);
  font-weight: 700;
}

.modal-sector-change {
  min-width: 76px;
  text-align: right;
  font-size: 18px;
  font-weight: 800;
}

.modal-sector-change.up {
  color: var(--color-danger);
}

.modal-sector-change.down {
  color: var(--color-success);
}

.modal-filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 14px 0;
}

@media (max-width: 1280px) {
  .section-header {
    gap: 8px;
  }

  .filter-row {
    flex-direction: column;
  }
}

@media (max-width: 768px) {
  .sector-modal-overlay {
    padding: 12px;
  }

  .sector-modal {
    width: 100%;
    height: 90vh;
    padding: 14px;
  }

  .modal-sector-list {
    grid-template-columns: 1fr;
  }

  .section-header {
    align-items: center;
  }

  .filter-row {
    flex-direction: column;
  }
}
</style>
