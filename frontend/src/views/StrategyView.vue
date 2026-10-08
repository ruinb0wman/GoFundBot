<template>
  <div class="strategy-page">
    <div class="page-header">
      <div class="page-title">
        <h1><LucideIcon name="NotebookPen" :size="22" /> {{ '策略研究' }}</h1>
        <p>{{ '在这里维护你的投资策略；pi（终端 AI）会读取启用的策略作为分析背景。' }}</p>
      </div>
      <div class="page-stats">
        <span class="stat-chip">
          <LucideIcon name="Activity" :size="14" />
          {{ `${activeCount} 个启用 · ${strategies.length} 个总计` }}
        </span>
        <a class="doc-link" href="/docs/strategy" target="_blank" title="查看文档" @click="openDocLink($event, '/docs/strategy/')">
          <LucideIcon name="HelpCircle" :size="16" />
        </a>
      </div>
    </div>

    <div class="page-body">
      <aside class="memory-panel">
        <div class="panel-head">
          <span class="panel-title"><LucideIcon name="BookMarked" :size="16" /> {{ '策略记忆' }}</span>
          <BButton size="small" plain @click="startCreate">
            <LucideIcon name="Plus" :size="14" /> {{ '新建' }}
          </BButton>
        </div>

        <div class="memory-list">
          <div v-if="strategies.length === 0" class="memory-empty">
            <LucideIcon name="BookOpen" :size="28" />
            <p>{{ '还没有策略记忆' }}</p>
            <p class="sub">{{ '点「新建」手动添加策略。' }}</p>
          </div>

          <div v-for="s in strategies" :key="s.id" class="memory-item" :class="{ disabled: !s.active }">
            <div class="mem-head">
              <span class="mem-title">{{ s.title }}</span>
              <div class="mem-actions">
                <BSwitch
                  size="small"
                  :model-value="s.active === 1"
                  @update:model-value="toggleActive(s, $event)"
                />
                <BButton circle size="small" :title="'预览'" @click="previewItem = s">
                  <LucideIcon name="Eye" :size="13" />
                </BButton>
                <BButton circle size="small" :title="'编辑'" @click="startEdit(s)">
                  <LucideIcon name="Pencil" :size="13" />
                </BButton>
                <BButton v-if="confirmDeleteId !== s.id" circle size="small" type="danger" :title="'删除'" @click="confirmDeleteId = s.id ?? null">
                  <LucideIcon name="Trash2" :size="13" />
                </BButton>
                <span v-else class="delete-confirm">
                  <BButton size="small" type="danger" @click="handleRemove(s)">{{ '确认' }}</BButton>
                  <BButton size="small" text @click="confirmDeleteId = null">{{ '取消' }}</BButton>
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

      <BaseModal
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
              <input type="checkbox" v-model="form.active" /> {{ '启用（供 AI 参考）' }}
            </label>
          </div>
        </div>
        <template #footer>
          <BButton size="small" @click="closeForm">{{ '取消' }}</BButton>
          <BButton size="small" type="primary" :disabled="!form.title.trim() || !form.content.trim()" @click="handleSave">
            {{ '保存' }}
          </BButton>
        </template>
      </BaseModal>

      <BaseModal
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
      </BaseModal>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BButton, BSwitch, BaseModal, LucideIcon } from '@gofund/ui'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'
import { openDocLink } from '../services/docLink'
import {
  listStrategies,
  addStrategy,
  updateStrategy,
  toggleStrategyActive,
  removeStrategy,
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

const activeCount = computed(() => strategies.value.filter(s => s.active === 1).length)

async function refresh() {
  strategies.value = await listStrategies()
}

onMounted(() => {
  refresh()
  // 写者无关：UI 表单、HTTP 客户端（pi 走 /api/agent/call → /api/strategies）都发同一个信号。
  window.addEventListener(STRATEGIES_CHANGED_EVENT, refresh)
})

onUnmounted(() => window.removeEventListener(STRATEGIES_CHANGED_EVENT, refresh))

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
