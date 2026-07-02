<template>
  <div class="fund-search" :class="{ 'compact-mode': compact }">
    <div class="search-header">
      <div class="search-box">
        <SearchBar
          v-model="searchKeyword"
          :placeholder="t('fund.search.placeholder')"
          @search="performSearch"
          @focus="isFocused = true"
          @blur="onBlur"
          :autofocus="autofocus"
        >
          <template #dropdown v-if="showHistoryDropdown">
            <div class="history-dropdown" @mousedown.prevent>
              <div class="history-header">
                <span>{{ t('fund.search.history') }}</span>
                <button class="history-clear-btn" @click="clearHistory">{{ t('fund.search.clear') }}</button>
              </div>
              <div
                v-for="(item, index) in searchHistory"
                :key="item.code"
                class="history-item"
                @click="selectFromHistory(item)"
              >
                <span class="history-code">{{ item.code }}</span>
                <span class="history-name">{{ item.name }}</span>
                <button class="history-remove" @click.stop="removeFromHistory(item.code)">
                  <LucideIcon name="X" :size="12" />
                </button>
              </div>
            </div>
          </template>
        </SearchBar>
        <button @click="performSearch" class="search-btn">{{ t('fund.search.searchBtn') }}</button>
        <button
          @click="updateDatabase"
          :disabled="updating"
          class="refresh-btn"
          :title="dbStatus.has_cache ? `${dbStatus.count} ${t('fund.search.itemCount')} | ${t('common.updated')}: ${formatDate(dbStatus.last_update)}` : t('fund.search.updateDb')"
        >
          <span v-if="updating" class="spinner"></span>
          <span v-else><LucideIcon name="RefreshCw" :size="16" /></span>
        </button>
      </div>
    </div>

    <div v-if="searchResults.length > 0" class="search-results">
      <div
        v-for="fund in searchResults"
        :key="fund.CODE"
        class="fund-item"
        :class="{ selected: selectMode && selectedFundCode === fund.CODE }"
        @click="selectFund(fund)"
      >
        <div class="fund-code">{{ fund.CODE }}</div>
        <div class="fund-name">{{ fund.NAME }}</div>
        <div class="fund-type">{{ fund.TYPE || '基金' }}</div>
      </div>
    </div>

    <div v-if="loading" class="loading">{{ t('fund.search.searching') }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { fundAPI } from '../services/api'
import { useSearchHistory } from '../composables/useSearchHistory'

const { t } = useI18n()

const props = defineProps({
  compact: {
    type: Boolean,
    default: false
  },
  selectMode: {
    type: Boolean,
    default: false
  },
  autofocus: {
    type: Boolean,
    default: false
  }
})

const selectedFundCode = ref('')

const emit = defineEmits(['fund-selected'])

const { searchHistory, addToHistory, removeFromHistory, clearHistory } = useSearchHistory()

const searchKeyword = ref('')
const searchResults = ref<any[]>([])
const loading = ref(false)
const updating = ref(false)
const searchTimer = ref<number | null>(null)
const isFocused = ref(false)
const dbStatus = ref({
  count: 0,
  last_update: '',
  has_cache: false
})

watch(searchKeyword, (val) => {
  if (searchTimer.value) clearTimeout(searchTimer.value)
  if (val && val.length >= 1) {
    searchTimer.value = window.setTimeout(performSearch, 150)
  } else {
    searchResults.value = []
  }
  if (props.selectMode) {
    selectedFundCode.value = ''
  }
})

onMounted(() => {
  fetchDbStatus()
})

async function fetchDbStatus() {
  try {
    const response = await fundAPI.getSearchStatus()
    dbStatus.value = response.data
  } catch (error) {
    console.error('获取数据库状态失败:', error)
  }
}

async function updateDatabase() {
  if (updating.value) return

  updating.value = true
  try {
    const response = await fundAPI.updateSearchDatabase()
    if (response.data.success) {
      dbStatus.value = {
        count: response.data.count,
        last_update: response.data.last_update,
        has_cache: true
      }
      alert(t('fund.search.updateSuccess', { count: response.data.count }))
    } else {
      alert(t('fund.search.updateFailed', { error: response.data.error }))
    }
  } catch (error) {
    console.error('更新数据库失败:', error)
    alert(t('fund.search.updateNetError'))
  } finally {
    updating.value = false
  }
}

function onBlur() {
  isFocused.value = false
}

const showHistoryDropdown = computed(() =>
  isFocused.value && !searchKeyword.value && searchHistory.value.length > 0 && searchResults.value.length === 0
)

function selectFromHistory(item: { code: string; name: string; type: string }) {
  searchKeyword.value = item.code
  performSearch()
}

function formatDate(dateStr: string) {
  if (!dateStr) return t('common.unknown')
  return dateStr.split(' ')[0]
}

async function performSearch() {
  if (!searchKeyword.value.trim()) return

  loading.value = true
  try {
    const response = await fundAPI.searchFunds(searchKeyword.value)
    searchResults.value = response.data.data || []
  } catch (error) {
    console.error('搜索失败:', error)
    searchResults.value = []
  } finally {
    loading.value = false
  }
}

function selectFund(fund: any) {
  addToHistory(fund)
  emit('fund-selected', fund)
  if (props.selectMode) {
    selectedFundCode.value = fund.CODE
  } else {
    searchResults.value = []
    searchKeyword.value = ''
  }
}
</script>

<style scoped>
.fund-search {
  margin-bottom: 20px;
  background: var(--bg-card);
  border-radius: 12px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
  position: relative;
}

.fund-search.compact-mode {
  margin-bottom: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

.fund-search.compact-mode .search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1000;
  margin-top: 4px;
}

.fund-search.compact-mode .loading {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1000;
  margin-top: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  box-shadow: var(--shadow-md);
}

.search-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  gap: 8px;
  flex: 1;
  min-width: 200px;
  align-items: center;
}

.search-box .search-bar {
  flex: 1;
}

.search-btn {
  padding: 10px 20px;
  background: var(--color-primary-hover);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  font-size: 14px;
  transition: all 0.2s;
}

.search-btn:hover {
  background: color-mix(in srgb, var(--color-primary-hover), black 20%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(22, 119, 255, 0.35);
}

.refresh-btn {
  width: 38px;
  height: 38px;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.3s;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.refresh-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.25);
  transform: rotate(180deg);
}

.refresh-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-default);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.search-results {
  border: 1px solid var(--border-default);
  border-radius: 8px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-card);
  box-shadow: var(--shadow-md);
  margin-top: 10px;
}

.fund-item {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: all 0.15s;
}

.fund-item:last-child {
  border-bottom: none;
}

.fund-item:hover {
  background: var(--bg-subtle);
}

.fund-item.selected {
  background: var(--color-primary-bg);
  border-left: 3px solid var(--color-primary);
}

.fund-code {
  font-weight: 600;
  color: var(--color-primary);
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 13px;
  min-width: 60px;
}

.fund-name {
  flex: 1;
  color: var(--text-primary);
  font-size: 14px;
}

.fund-type {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-subtle);
  padding: 2px 8px;
  border-radius: 10px;
}

.loading {
  text-align: center;
  padding: 12px;
  color: var(--text-secondary);
  font-size: 14px;
}

.history-dropdown {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  box-shadow: var(--shadow-md);
  max-height: 320px;
  overflow-y: auto;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
}

.history-clear-btn {
  border: none;
  background: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
}

.history-clear-btn:hover {
  background: var(--bg-subtle);
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.history-item:hover {
  background: var(--bg-subtle);
}

.history-code {
  font-weight: 600;
  color: var(--color-primary);
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  min-width: 60px;
}

.history-name {
  flex: 1;
  color: var(--text-primary);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-remove {
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.history-item:hover .history-remove {
  opacity: 1;
}

.history-remove:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
</style>
