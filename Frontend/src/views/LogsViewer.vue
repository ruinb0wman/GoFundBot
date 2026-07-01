<template>
  <div class="logs-page">
    <div class="logs-toolbar">
      <select v-model="source" class="tb-select" @change="loadLogs">
        <option value="backend">Backend</option>
        <option value="dataservice">DataService</option>
        <option value="frontend">Frontend</option>
      </select>
      <input type="date" v-model="dateStr" class="tb-input" @change="loadLogs" />
      <select v-model="levelFilter" class="tb-select" @change="loadLogs">
        <option value="">All</option>
        <option value="error">Error</option>
        <option value="warn">Warn</option>
        <option value="info">Info</option>
      </select>
      <input
        v-model="keyword"
        class="tb-input search-input"
        :placeholder="t('logs.searchPlaceholder')"
        @input="onSearchInput"
      />
      <button class="tb-btn" @click="loadLogs" :disabled="loading">
        <LucideIcon name="RefreshCw" :size="16" :class="{ spinning: loading }" />
      </button>
    </div>

    <div class="stats-row">
      <div class="stat-card stat-error">
        <span class="stat-num">{{ stats.error || 0 }}</span>
        <span class="stat-label">{{ t('logs.statError') }}</span>
      </div>
      <div class="stat-card stat-warn">
        <span class="stat-num">{{ stats.warn || 0 }}</span>
        <span class="stat-label">{{ t('logs.statWarn') }}</span>
      </div>
      <div class="stat-card stat-info">
        <span class="stat-num">{{ stats.info || 0 }}</span>
        <span class="stat-label">{{ t('logs.statInfo') }}</span>
      </div>
    </div>

    <div class="log-table-wrap">
      <VxeTable
        :data="entries"
        :row-config="{ useKey: true }"
        stripe
        max-height="600"
        class="log-table"
      >
        <template #loading>
          <div class="vxe-loading">{{ t('logs.loading') }}</div>
        </template>
        <VxeColumn type="seq" width="50" />
        <VxeColumn field="time" :title="t('logs.time')" width="180">
          <template #default="{ row }">
            <span class="cell-time">{{ formatTime(row.time) }}</span>
          </template>
        </VxeColumn>
        <VxeColumn field="source" :title="t('logs.source')" width="110" />
        <VxeColumn field="level" :title="t('logs.level')" width="80">
          <template #default="{ row }">
            <span :class="['level-badge', 'level-' + (row.level || 'info')]">
              {{ row.level }}
            </span>
          </template>
        </VxeColumn>
        <VxeColumn field="message" :title="t('logs.message')" min-width="200" show-overflow="tooltip" />
        <VxeColumn :title="t('logs.context')" width="100">
          <template #default="{ row }">
            <button
              v-if="row.context || row.module"
              class="tb-btn tb-btn-sm"
              @click="expandRow(row)"
            >
              {{ t('logs.view') }}
            </button>
          </template>
        </VxeColumn>
      </VxeTable>
    </div>

    <div class="pagination-row" v-if="total > limit">
      <span class="page-info">{{ t('logs.total') }} {{ total }} {{ t('logs.items') }}</span>
      <button class="tb-btn" :disabled="offset <= 0" @click="prevPage">{{ t('logs.prevPage') }}</button>
      <span class="page-num">{{ currentPage }} / {{ maxPage }}</span>
      <button class="tb-btn" :disabled="offset + limit >= total" @click="nextPage">{{ t('logs.nextPage') }}</button>
    </div>

    <div class="analysis-section">
      <h3>{{ t('logs.aiAnalysis') }}</h3>
      <button class="tb-btn tb-btn-primary" @click="runAnalysis" :disabled="analyzing">
        <LucideIcon name="Sparkles" :size="16" />
        {{ analyzing ? t('logs.analyzing') : t('logs.startAnalysis') }}
      </button>
      <div v-if="analyzing" class="analysis-loading">
        {{ t('logs.analyzingLogs') }}
      </div>
      <div v-if="analysisError" class="analysis-error">{{ analysisError }}</div>
      <div v-if="analysisResult" class="analysis-report">
        <div class="report-summary">
          <p>{{ t('logs.totalLogs') }} <strong>{{ analysisResult.total }}</strong></p>
          <p>{{ t('logs.statError') }}: <strong class="text-error">{{ analysisResult.error_count }}</strong></p>
          <p>{{ t('logs.statWarn') }}: <strong class="text-warn">{{ analysisResult.warn_count }}</strong></p>
        </div>
        <div v-if="analysisResult.patterns" class="report-section">
          <h4>{{ t('logs.errorPatterns') }}</h4>
          <ul>
            <li v-for="(p, i) in analysisResult.patterns" :key="i">{{ p }}</li>
          </ul>
        </div>
        <div v-if="analysisResult.suggestions" class="report-section">
          <h4>{{ t('logs.optimizationSuggestions') }}</h4>
          <ul>
            <li v-for="(s, i) in analysisResult.suggestions" :key="i">{{ s }}</li>
          </ul>
        </div>
        <div v-if="analysisResult.critical" class="report-section section-critical">
          <h4>{{ t('logs.criticalItems') }}</h4>
          <ul>
            <li v-for="(c, i) in analysisResult.critical" :key="i">{{ c }}</li>
          </ul>
        </div>
        <div v-if="analysisResult.llm_error" class="report-section section-error">
          <p>LLM 错误: {{ analysisResult.llm_error }}</p>
        </div>
      </div>
    </div>

    <div class="modal-overlay" v-if="detailEntry" @click.self="detailEntry = null">
      <div class="modal-card">
        <h4>日志详情</h4>
        <pre>{{ JSON.stringify(detailEntry, null, 2) }}</pre>
        <button class="tb-btn" @click="detailEntry = null">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxeTable, VxeColumn } from 'vxe-table'

const { t } = useI18n()

const source = ref('backend')
const dateStr = ref(new Date().toISOString().slice(0, 10))
const levelFilter = ref('')
const keyword = ref('')
const loading = ref(false)
const entries = ref<any[]>([])
const total = ref(0)
const stats = ref<Record<string, number>>({})
const offset = ref(0)
const limit = 200
const detailEntry = ref<any>(null)

const analyzing = ref(false)
const analysisError = ref('')
const analysisResult = ref<any>(null)

const currentPage = computed(() => Math.floor(offset.value / limit) + 1)
const maxPage = computed(() => Math.max(1, Math.ceil(total.value / limit)))

let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadLogs, 400)
}

function formatTime(t: string) {
  if (!t) return ''
  try {
    const d = new Date(t)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return t.slice(0, 19)
  }
}

function expandRow(row: any) {
  detailEntry.value = row
}

async function loadLogs() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      source: source.value,
      date: dateStr.value,
      limit: String(limit),
      offset: String(offset.value),
    })
    if (levelFilter.value) params.set('level', levelFilter.value)
    if (keyword.value.trim()) params.set('q', keyword.value.trim())

    const res = await fetch(`/api/logs/read?${params}`)
    const json = await res.json()
    if (json.success) {
      entries.value = json.data
      total.value = json.total
      stats.value = json.counts || {}
    }
  } catch (e: any) {
    console.error('加载日志失败', e)
  } finally {
    loading.value = false
  }
}

function prevPage() {
  offset.value = Math.max(0, offset.value - limit)
  loadLogs()
}

function nextPage() {
  offset.value += limit
  loadLogs()
}

async function runAnalysis() {
  analyzing.value = true
  analysisError.value = ''
  analysisResult.value = null
  try {
    const res = await fetch('/api/logs/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: source.value, date: dateStr.value }),
    })
    const json = await res.json()
    if (json.success) {
      analysisResult.value = json.data
    } else {
      analysisError.value = json.error || '分析失败'
    }
  } catch (e: any) {
    analysisError.value = String(e)
  } finally {
    analyzing.value = false
  }
}

onMounted(loadLogs)
</script>



<style scoped>
.logs-page {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.logs-toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 16px;
}

.tb-select, .tb-input {
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
}

.search-input {
  flex: 1;
  min-width: 160px;
}

.tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}

.tb-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tb-btn:hover:not(:disabled) {
  background: var(--bg-subtle);
}

.tb-btn-sm {
  padding: 3px 8px;
  font-size: 12px;
}

.tb-btn-primary {
  background: var(--color-primary);
  color: var(--text-inverse);
  border-color: var(--color-primary);
}

.tb-btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.stats-row {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  flex: 1;
  padding: 16px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
}

.stat-num {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.stat-label {
  font-size: 13px;
  color: var(--text-tertiary);
}

.stat-error .stat-num { color: var(--color-danger, #ef4444); }
.stat-warn .stat-num { color: var(--color-warning, #f59e0b); }
.stat-info .stat-num { color: var(--color-info, #3b82f6); }
.stat-error { border-left: 3px solid var(--color-danger, #ef4444); }
.stat-warn { border-left: 3px solid var(--color-warning, #f59e0b); }
.stat-info { border-left: 3px solid var(--color-info, #3b82f6); }

.log-table-wrap {
  margin-bottom: 16px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  overflow: hidden;
}

.cell-time {
  font-family: monospace;
  font-size: 12px;
}

.level-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.level-error {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-danger, #ef4444);
}

.level-warn {
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-warning, #f59e0b);
}

.level-info {
  background: rgba(59, 130, 246, 0.12);
  color: var(--color-info, #3b82f6);
}

.level-unknown {
  background: var(--bg-subtle);
  color: var(--text-tertiary);
}

.pagination-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 24px;
}

.page-info {
  font-size: 13px;
  color: var(--text-tertiary);
}

.page-num {
  font-size: 13px;
  color: var(--text-secondary);
}

.analysis-section {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 20px;
}

.analysis-section h3 {
  margin: 0 0 12px;
  font-size: 16px;
}

.analysis-loading {
  margin-top: 12px;
  color: var(--text-tertiary);
}

.analysis-error {
  margin-top: 12px;
  color: var(--color-danger, #ef4444);
}

.analysis-report {
  margin-top: 16px;
}

.report-summary {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  font-size: 14px;
}

.report-summary p {
  margin: 0;
}

.text-error { color: var(--color-danger, #ef4444); }
.text-warn { color: var(--color-warning, #f59e0b); }

.report-section {
  margin-bottom: 14px;
}

.report-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
}

.report-section ul {
  margin: 0;
  padding-left: 20px;
}

.report-section li {
  margin-bottom: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.section-critical {
  padding: 12px;
  border: 1px solid var(--color-danger, #ef4444);
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.05);
}

.section-error {
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-subtle);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 6000;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-card {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 24px;
  max-width: 700px;
  width: 90vw;
  max-height: 80vh;
  overflow: auto;
}

.modal-card h4 {
  margin: 0 0 12px;
}

.modal-card pre {
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg-subtle);
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}

@media (max-width: 768px) {
  .logs-page {
    padding: 12px;
  }
  .stats-row {
    flex-direction: column;
  }
}
</style>
