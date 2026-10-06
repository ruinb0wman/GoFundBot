<template>
  <aside class="script-panel">
    <div class="panel-head">
      <span class="panel-title"><LucideIcon name="Code2" :size="16" /> {{ '回测方案' }}</span>
      <BButton size="small" plain @click="$emit('create')">
        <LucideIcon name="Plus" :size="14" /> {{ '新建' }}
      </BButton>
    </div>

    <div class="script-list">
      <div v-if="scripts.length === 0" class="script-empty">
        <LucideIcon name="FileCode2" :size="26" />
        <p>{{ '还没有保存的方案' }}</p>
        <p class="sub">{{ '点「新建」写一段策略代码，或让右侧 AI 帮你写' }}</p>
      </div>

      <div
        v-for="script in scripts"
        :key="script.id"
        class="script-item"
        :class="{ active: script.id === currentId }"
        @click="$emit('select', script.id as number)"
      >
        <div class="item-head">
          <span class="item-name">{{ script.name }}</span>
          <span v-if="script.source === 'ai'" class="ai-badge">AI</span>
        </div>
        <div class="item-foot">
          <span>{{ script.lastRunAt ? `上次运行 ${formatTime(script.lastRunAt)}` : '尚未运行' }}</span>
          <div class="item-actions" @click.stop>
            <BButton circle size="small" title="复制" @click="$emit('duplicate', script.id as number)">
              <LucideIcon name="Copy" :size="12" />
            </BButton>
            <BButton
              v-if="confirmDeleteId !== script.id"
              circle
              size="small"
              type="danger"
              title="删除"
              @click="confirmDeleteId = script.id ?? null"
            >
              <LucideIcon name="Trash2" :size="12" />
            </BButton>
            <template v-else>
              <BButton size="small" type="danger" @click="$emit('remove', script.id as number); confirmDeleteId = null">
                {{ '确认' }}
              </BButton>
              <BButton size="small" text @click="confirmDeleteId = null">{{ '取消' }}</BButton>
            </template>
          </div>
        </div>
        <div v-if="script.lastSummary" class="item-summary">
          {{ `收益 ${formatPct(script.lastSummary.return_rate)} · 回撤 ${script.lastSummary.max_drawdown}%` }}
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { BButton, LucideIcon } from '@gofund/ui'
import type { StrategyScriptRecord } from '../../db/strategyScripts'

defineProps<{ scripts: StrategyScriptRecord[]; currentId: number | null }>()
defineEmits<{
  select: [id: number]
  create: []
  duplicate: [id: number]
  remove: [id: number]
}>()

const confirmDeleteId = ref<number | null>(null)

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}%`
}
</script>

<style scoped>
.script-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-default);
  font-size: 13px;
  font-weight: 600;
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.script-list {
  flex: 1;
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.script-empty {
  text-align: center;
  color: var(--text-secondary);
  padding: 24px 8px;
  font-size: 12px;
}

.script-empty .sub {
  opacity: 0.7;
}

.script-item {
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  cursor: pointer;
}

.script-item.active {
  border-color: var(--color-primary);
  background: rgba(22, 119, 255, 0.06);
}

.item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.item-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-badge {
  flex: 0 0 auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(22, 119, 255, 0.15);
  color: var(--color-primary);
}

.item-foot,
.item-summary {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
