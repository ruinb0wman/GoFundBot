<template>
  <div class="sector-rank-container">
    <div class="section-header">
      <div class="section-header-row section-header-actions">
        <h3><LucideIcon name="Factory" :size="20" /> {{ '行业板块排行' }}</h3>
        <a class="doc-link" href="/docs/market-sector-rank" target="_blank" title="查看文档">
          <LucideIcon name="HelpCircle" :size="16" />
        </a>
        <div class="section-header-buttons">
          <BButton circle icon="RefreshCw" :loading="loading" @click="fetchSectors" :title="'刷新板块数据'" />
          <BButton
            circle
            icon="Maximize2"
            @click="openSectorModal()"
            :disabled="!sectors.length"
            :title="'放大查看板块排行'"
          />
        </div>
      </div>
      <div class="section-header-row section-header-meta">
        <span v-if="isFromCache && sectors.length" class="data-source-badge stale" :title="'本地缓存'">
          <LucideIcon name="Package" :size="14" /> {{ '本地缓存' }}
        </span>
        <span v-if="dataDate" class="data-date" :title="'数据对应的交易日'">
          <LucideIcon v-if="isStale" name="Calendar" :size="14" /> {{ '数据日期' }} {{ dataDate }}
        </span>
        <span class="update-tag" v-if="adaptiveRefresh.lastSuccessTime.value && sectors.length">
          {{ '更新于' }} {{ formatUpdateTime(adaptiveRefresh.lastSuccessTime.value) }}
        </span>
        <span v-if="adaptiveRefresh.isStale.value && sectors.length" class="stale-badge"><LucideIcon name="Clock" :size="14" /> {{ '超时' }}</span>
      </div>
    </div>
    <div class="filter-panel">
      <div class="market-stats" v-if="sectors.length">
        <span class="stat-chip total">{{ isFromCache ? '缓存数据' : '实时数据' }} {{ sectors.length }}</span>
        <span class="stat-chip up">{{ '上涨' }} {{ upCount }}</span>
        <span class="stat-chip flat">{{ '平盘' }} {{ flatCount }}</span>
        <span class="stat-chip down">{{ '下跌' }} {{ downCount }}</span>
      </div>
    </div>

    <div v-if="loading && !sectors.length" class="loading-state">
      <span class="loading-spinner"></span>
      <span>{{ '加载中...' }}</span>
    </div>

    <div v-else-if="error" class="error-state">
      <span>{{ error }}</span>
      <BButton type="danger" size="small" @click="fetchSectors">{{ '重试' }}</BButton>
    </div>

    <div v-else class="sector-content">
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
              <span class="label">{{ '主力:' }}</span>
              <span :class="getFlowClass(sector.main_inflow)">{{ sector.main_inflow }}</span>
            </div>
          </div>
          <div class="sector-change" :class="{ 'up': sector.raw_change > 0, 'down': sector.raw_change < 0 }">
            {{ fmtPercent(sector.change_pct) }}
          </div>
        </div>
      </div>

      <div v-if="!displayedSectors.length" class="empty-filter">{{ '没有匹配的板块' }}</div>

      <div v-if="filteredSectors.length > pageSize" class="pagination">
        <BButton size="small" @click="currentPage = 1" :disabled="currentPage === 1">{{ '首页' }}</BButton>
        <BButton size="small" @click="currentPage -= 1" :disabled="currentPage === 1">{{ '上一页' }}</BButton>
        <span class="page-info">{{ `第 ${currentPage} / ${totalPages} 页` }}</span>
        <BButton size="small" @click="currentPage += 1" :disabled="currentPage === totalPages">{{ '下一页' }}</BButton>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="modalVisible" class="sector-modal-overlay" @click.self="closeSectorModal">
        <div class="sector-modal">
          <div class="modal-header">
            <div>
              <h3>{{ '行业板块排行' }}</h3>
              <p>
                {{ dataDate || '最新数据' }}
                <span>{{ '上涨' }} {{ upCount }}</span>
                <span>{{ '下跌' }} {{ downCount }}</span>
                <span>{{ `共 ${filteredSectors.length} 个` }}</span>
              </p>
            </div>
            <button class="modal-close" @click="closeSectorModal">×</button>
          </div>

          <div class="modal-filters">
            <SearchBar
              v-model.trim="keyword"
              :placeholder="'搜索板块名称或代码...'"
              compact
              size="sm"
            />
            <div class="filter-row">
              <select v-model="sortBy" class="sort-select">
                <option value="change_desc">{{ '涨跌幅 ↓' }}</option>
                <option value="change_asc">{{ '涨跌幅 ↑' }}</option>
                <option value="inflow_desc">{{ '主力净流入 ↓' }}</option>
                <option value="inflow_asc">{{ '主力净流入 ↑' }}</option>
                <option value="name">{{ '按名称' }}</option>
              </select>
              <select v-model="changeFilter" class="sort-select">
                <option value="all">{{ '全部涨跌' }}</option>
                <option value="up">{{ '上涨' }}</option>
                <option value="down">{{ '下跌' }}</option>
                <option value="flat">{{ '平盘' }}</option>
              </select>
              <select v-model="flowFilter" class="sort-select">
                <option value="all">{{ '全部资金' }}</option>
                <option value="inflow">{{ '主力流入' }}</option>
                <option value="outflow">{{ '主力流出' }}</option>
              </select>
            </div>
            <div class="market-stats" v-if="sectors.length">
              <span class="stat-chip total">{{ isFromCache ? '缓存数据' : '实时数据' }} {{ sectors.length }}</span>
              <span class="stat-chip up">{{ '上涨' }} {{ upCount }}</span>
              <span class="stat-chip flat">{{ '平盘' }} {{ flatCount }}</span>
              <span class="stat-chip down">{{ '下跌' }} {{ downCount }}</span>
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
                  {{ '主力净流入' }} <span :class="getFlowClass(sector.main_inflow)">{{ sector.main_inflow }}</span>
                </div>
              </div>
              <div class="modal-sector-change" :class="{ up: sector.raw_change > 0, down: sector.raw_change < 0 }">
                {{ fmtPercent(sector.change_pct) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { BButton } from '@gofund/ui'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

import { marketAPI } from '../services/api'
import { useAdaptiveRefresh } from '../composables/useAdaptiveRefresh'
import { fmtPercent } from '../utils/number'

function formatUpdateTime(isoStr: string) {
  try {
    return new Date(isoStr).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return isoStr.slice(11, 19) }
}

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

const adaptiveRefresh = useAdaptiveRefresh({
  fetcher: async () => {
    return await fetchSectors() as unknown as boolean
  },
})

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
      return true
    }
    if (response.data.data?.length) {
      applySectorData(response.data.data, {
        update_time: response.data.update_time || '',
        data_date: response.data.data_date || '',
        is_stale: !!response.data.is_stale,
        is_partial: true,
        source: 'backend_partial'
      })
      return true
    }
    clearSectorData()
    error.value = response.data.error || '出错'
    return false
  } catch (e) {
    if (!sectors.value.length) {
      error.value = '网络异常，请稍后重试'
    }
    console.error('获取板块排行失败:', e)
    return false
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
  adaptiveRefresh.start()
})

onUnmounted(() => {
  adaptiveRefresh.stop()
})
</script>

<style src="./SectorRank.css" scoped></style>
