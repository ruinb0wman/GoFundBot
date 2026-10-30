<template>
  <div class="strategy-page">
    <div class="page-header">
      <div class="page-title">
        <h1><RLucideIcon name="NotebookPen" :size="22" /> {{ '策略研究' }}</h1>
        <p>{{ '在这里维护你的投资策略；pi（终端 AI）可以读到全部策略，「启用」标记出你当前在用的那几条。' }}</p>
      </div>
      <div class="page-stats">
        <span class="stat-chip">
          <RLucideIcon name="Activity" :size="14" />
          {{ `${activeCount} 个启用 · ${strategies.length} 个总计` }}
        </span>
        <RButton size="small" plain :title="'策略文件夹与刷新'" @click="openDir">
          <RLucideIcon name="FolderOpen" :size="14" /> {{ '文件夹' }}
        </RButton>
        <a class="doc-link" href="/docs/strategy" target="_blank" title="查看文档" @click="openDocLink($event, '/docs/strategy/')">
          <RLucideIcon name="HelpCircle" :size="16" />
        </a>
      </div>
    </div>

    <div class="page-body">
      <aside class="memory-panel">
        <div class="panel-head">
          <span class="panel-title"><RLucideIcon name="BookMarked" :size="16" /> {{ '策略记忆' }}</span>
          <div class="panel-actions">
            <RButton size="small" plain @click="startCreate">
              <RLucideIcon name="Plus" :size="14" /> {{ '新建' }}
            </RButton>
            <RButton circle size="small" :title="'刷新（重读磁盘）'" @click="refresh">
              <RLucideIcon name="RefreshCw" :size="13" />
            </RButton>
          </div>
        </div>

        <div class="memory-list">
          <div v-if="strategies.length === 0" class="memory-empty">
            <RLucideIcon name="BookOpen" :size="28" />
            <p>{{ strategyDir ? '还没有策略记忆' : '还没有配置策略文件夹' }}</p>
            <p class="sub">
              {{ strategyDir ? '点「新建」手动添加，或把 .md 放进文件夹后点刷新。' : '点右上角「文件夹」填一个绝对路径，目录里的每个 .md 就是一条策略。' }}
            </p>
          </div>

          <div v-for="s in strategies" :key="s.id" class="memory-item" :class="{ disabled: !s.active }">
            <div class="mem-head">
              <span class="mem-title">{{ s.title }}</span>
              <div class="mem-actions">
                <RSwitch
                  size="small"
                  :model-value="s.active === 1"
                  @update:model-value="toggleActive(s, $event)"
                />
                <RButton circle size="small" :title="'预览'" @click="previewItem = s">
                  <RLucideIcon name="Eye" :size="13" />
                </RButton>
                <RButton circle size="small" :title="'编辑'" @click="startEdit(s)">
                  <RLucideIcon name="Pencil" :size="13" />
                </RButton>
                <RButton v-if="confirmDeleteId !== s.id" circle size="small" type="danger" :title="'删除'" @click="confirmDeleteId = s.id ?? null">
                  <RLucideIcon name="Trash2" :size="13" />
                </RButton>
                <span v-else class="delete-confirm">
                  <RButton size="small" type="danger" @click="handleRemove(s)">{{ '确认' }}</RButton>
                  <RButton size="small" text @click="confirmDeleteId = null">{{ '取消' }}</RButton>
                </span>
              </div>
            </div>
            <div v-if="s.tags && s.tags.length" class="mem-tags">
              <span v-for="(t, i) in s.tags" :key="i" class="tag-chip">{{ t }}</span>
            </div>
            <p class="mem-content">{{ s.content }}</p>
            <div class="mem-foot">
              <span class="mem-source">{{ s.source === 'ai-draft' ? 'AI起草' : '手动' }}</span>
              <span class="mem-time">{{ formatDate(s.updatedAt) }}</span>
            </div>
          </div>
        </div>
      </aside>

      <RModal
        :visible="dirOpen"
        title="策略文件夹"
        :width="620"
        @close="dirOpen = false"
      >
        <div class="editor-body">
          <div class="editor-field">
            <label>{{ '文件夹绝对路径' }}</label>
            <input v-model="dirInput" class="text-input" placeholder="/home/you/notes/strategies" />
          </div>
          <p class="dir-hint">
            {{ '文件夹里的每个 .md 就是一条策略：frontmatter 里的 id 是标识，文件名随意；正文就是策略内容。目录不存在会自动创建，留空则关闭策略记忆。' }}
          </p>
          <p v-if="dirError" class="dir-error">{{ dirError }}</p>
        </div>
        <template #footer>
          <RButton size="small" @click="dirOpen = false">{{ '取消' }}</RButton>
          <RButton size="small" type="primary" :disabled="dirSaving" @click="handleSaveDir">{{ '保存' }}</RButton>
        </template>
      </RModal>

      <RModal
        :visible="formOpen"
        :title="editingId != null ? '编辑策略记忆' : '新建策略记忆'"
        :width="680"
        :close-on-overlay="false"
        @close="closeForm"
      >
        <div class="editor-body">
          <div class="editor-field">
            <label>{{ '标题' }}</label>
            <input v-model="form.title" class="text-input" placeholder="例如：稳健定投计划" maxlength="40" />
          </div>
          <div class="editor-field">
            <label>{{ '标签（逗号分隔）' }}</label>
            <input v-model="form.tagsText" class="text-input" placeholder="定投, 长期持有" />
          </div>
          <div class="editor-field">
            <label>{{ '策略内容' }}</label>
            <textarea
              v-model="form.content"
              class="text-area" rows="10"
              placeholder="描述你的投资目标、资金分配、买卖纪律、风险管理等…"
            />
          </div>
          <div class="editor-row">
            <label class="toggle-label">
              <input type="checkbox" v-model="form.active" /> {{ '启用' }}
            </label>
          </div>
        </div>
        <template #footer>
          <RButton size="small" @click="closeForm">{{ '取消' }}</RButton>
          <RButton size="small" type="primary" :disabled="!form.title.trim() || !form.content.trim()" @click="handleSave">
            {{ '保存' }}
          </RButton>
        </template>
      </RModal>

      <RModal
        :visible="previewItem !== null"
        :title="previewItem?.title ?? '策略预览'"
        :width="620"
        @close="previewItem = null"
      >
        <div v-if="previewItem" class="preview-body">
          <div v-if="previewItem.tags && previewItem.tags.length" class="mem-tags">
            <span v-for="(t, i) in previewItem.tags" :key="i" class="tag-chip">{{ t }}</span>
          </div>
          <div class="preview-content" v-html="renderMarkdown(previewItem.content)" />
          <div class="mem-foot">
            <span class="mem-source">{{ previewItem.source === 'ai-draft' ? 'AI起草' : '手动' }}</span>
            <span class="mem-time">{{ formatDate(previewItem.updatedAt) }}</span>
          </div>
        </div>
      </RModal>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RButton, RSwitch, RModal, RLucideIcon } from '@ruinb0w/ui'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'
import { openDocLink } from '../services/docLink'
import {
  listStrategies,
  addStrategy,
  updateStrategy,
  toggleStrategyActive,
  removeStrategy,
  fetchStrategyDir,
  saveStrategyDir,
  STRATEGIES_CHANGED_EVENT,
  type StrategyInput,
} from '../db/strategyMemory'
import type { StrategyRecord } from '../types/records'

defineOptions({ name: 'StrategyView' })

const strategies = ref<StrategyRecord[]>([])
const formOpen = ref(false)
const editingId = ref<number | null>(null)
const form = ref({ title: '', content: '', tagsText: '', active: true })
const confirmDeleteId = ref<number | null>(null)
const previewItem = ref<StrategyRecord | null>(null)

const strategyDir = ref('')
const dirOpen = ref(false)
const dirInput = ref('')
const dirError = ref('')
const dirSaving = ref(false)

const activeCount = computed(() => strategies.value.filter(s => s.active === 1).length)

async function refresh() {
  strategies.value = await listStrategies()
}

async function loadDir() {
  try {
    strategyDir.value = await fetchStrategyDir()
  } catch {
    strategyDir.value = ''
  }
}

function openDir() {
  dirInput.value = strategyDir.value
  dirError.value = ''
  dirOpen.value = true
}

async function handleSaveDir() {
  dirSaving.value = true
  dirError.value = ''
  try {
    strategyDir.value = await saveStrategyDir(dirInput.value.trim())
    dirOpen.value = false
    await refresh()
  } catch (error) {
    const message = (error as { response?: { data?: { error?: { message?: string } } } })
      ?.response?.data?.error?.message
    dirError.value = message || '保存失败：请检查是绝对路径且目录可写'
  } finally {
    dirSaving.value = false
  }
}

onMounted(() => {
  loadDir()
  refresh()
  // 写者无关：UI 表单、HTTP 客户端（pi 走 /api/agent/call → /api/strategies）都发同一个信号。
  window.addEventListener(STRATEGIES_CHANGED_EVENT, refresh)
  // 策略是磁盘上的文件：切回窗口时重读，外部编辑器改完不必手动刷新。
  window.addEventListener('focus', refresh)
})

onUnmounted(() => {
  window.removeEventListener(STRATEGIES_CHANGED_EVENT, refresh)
  window.removeEventListener('focus', refresh)
})

function openForm() {
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
  form.value = { title: '', content: '', tagsText: '', active: true }
  confirmDeleteId.value = null
}

function startCreate() {
  editingId.value = null
  form.value = { title: '', content: '', tagsText: '', active: true }
  openForm()
}

function startEdit(s: StrategyRecord) {
  editingId.value = s.id ?? null
  form.value = {
    title: s.title,
    content: s.content,
    tagsText: (s.tags ?? []).join(', '),
    active: s.active === 1,
  }
  openForm()
}

async function handleSave() {
  const input: StrategyInput = {
    title: form.value.title,
    content: form.value.content,
    tags: form.value.tagsText.split(/[,，]/).map(t => t.trim()).filter(Boolean),
    active: form.value.active ? 1 : 0,
  }
  if (editingId.value != null) {
    await updateStrategy(editingId.value, input)
  } else {
    await addStrategy(input)
  }
  closeForm()
  await refresh()
}

async function toggleActive(s: StrategyRecord, active: boolean) {
  await toggleStrategyActive(s.id!, active)
  await refresh()
}

async function handleRemove(s: StrategyRecord) {
  await removeStrategy(s.id!)
  confirmDeleteId.value = null
  await refresh()
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text, { breaks: true }) as string
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
</script>

<style src="./StrategyView.css" scoped></style>
