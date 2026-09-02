<template>
  <div class="fund-list-items" @dragover.prevent @drop="$emit('drop', $event, groupId)">
    <div
      v-for="(fund, index) in funds"
      :key="fund.fund_code"
      class="list-item"
      :class="{
        'selected': selectedFunds.includes(fund.fund_code),
        'dragging': isDragging(index),
        'in-compare': isInCompare(fund.fund_code),
      }"
      :draggable="editMode"
      @dragstart="$emit('drag-start', $event, index, groupId)"
      @dragend="$emit('drag-end')"
      @dragover="$emit('drag-over', $event, index, groupId)"
    >
      <div class="col-checkbox" v-if="editMode">
        <BCheckbox :modelValue="selectedFunds.includes(fund.fund_code)" @update:modelValue="$emit('toggle-select', fund.fund_code)" size="small" />
      </div>

      <div class="col-drag" v-if="editMode">
        <span class="drag-handle">⋮⋮</span>
      </div>

      <div class="col-compare" v-if="compareMode && !editMode">
        <BButton
          circle size="small"
          :type="isInCompare(fund.fund_code) ? 'primary' : 'default'"
          @click.stop="$emit('add-to-compare', { code: fund.fund_code, name: fund.fund_name })"
          :title="isInCompare(fund.fund_code) ? '已添加到对比' : '添加到对比'"
        >
          <LucideIcon :name="isInCompare(fund.fund_code) ? 'Check' : 'Plus'" :size="14" />
        </BButton>
      </div>

      <div class="col-name" @click="!editMode && !compareMode && $emit('view-fund', fund.fund_code)">
        <div class="fund-name">{{ fund.fund_name }}</div>
        <div class="fund-code">{{ fund.fund_code }}</div>
      </div>

      <div class="col-nav">
        <div class="nav-value">{{ fund.estimate_value || fund.net_worth || '--' }}</div>
        <div class="nav-date">{{ fund.estimate_time || fund.net_worth_date || '' }}</div>
      </div>

      <div class="col-change" :class="getChangeClass(fund.estimate_change)">
        {{ formatChange(fund.estimate_change) }}
      </div>

      <div class="col-action" v-if="!editMode && !compareMode">
        <BButton
          circle size="small"
          v-if="addToRealtimeMode"
          @click.stop="$emit('add-to-realtime', fund)"
          :title="'添加到实时估值'"
          icon="Plus"
        />
        <template v-else>
          <BButton
            circle size="small"
            @click.stop="$emit('show-alert-settings', fund.fund_code)"
            :title="'告警设置'"
            icon="Bell"
          />

        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BButton, BCheckbox } from '@gofund/ui'
import type { DraggingIndex, CompareFund } from '../types'

const props = withDefaults(defineProps<{
  funds?: any[]
  editMode?: boolean
  selectedFunds?: string[]
  draggingIndex?: DraggingIndex | null
  groupId?: number | null
  compareMode?: boolean
  compareFunds?: CompareFund[]
  addToRealtimeMode?: boolean
}>(), {
  funds: () => [],
  editMode: false,
  selectedFunds: () => [],
  draggingIndex: null,
  groupId: null,
  compareMode: false,
  compareFunds: () => [],
  addToRealtimeMode: false,
})

defineEmits<{
  'toggle-select': [fundCode: string]
  'view-fund': [fundCode: string]
  'remove-fund': [fundCode: string]
  'drag-start': [event: DragEvent, index: number, groupId: number | null]
  'drag-end': []
  'drag-over': [event: DragEvent, index: number, groupId: number | null]
  'drop': [event: DragEvent, groupId: number | null]
  'add-to-compare': [payload: { code: string; name: string }]
  'add-to-realtime': [fund: any]
  'show-alert-settings': [fundCode: string]
}>()

function isDragging(index: number): boolean {
  return !!(props.draggingIndex &&
    props.draggingIndex.index === index &&
    props.draggingIndex.groupId === props.groupId)
}

function isInCompare(fundCode: string): boolean {
  return !!(props.compareFunds && props.compareFunds.some(f => f.code === fundCode))
}

function formatChange(change: unknown): string {
  if (!change && change !== 0) return '--'
  const num = parseFloat(String(change))
  if (isNaN(num)) return String(change)
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(2)}%`
}

function getChangeClass(change: unknown): string {
  if (!change && change !== 0) return ''
  const num = parseFloat(String(change))
  if (isNaN(num)) return ''
  if (num > 0) return 'change-up'
  if (num < 0) return 'change-down'
  return 'change-flat'
}
</script>

<style scoped>
.fund-list-items { min-height: 20px; }
.list-item {
  display: flex; align-items: center; padding: 8px 12px; gap: 8px;
  border-bottom: 1px solid var(--border-subtle); transition: all 0.15s; cursor: pointer;
}
.list-item:last-child { border-bottom: none; }
.list-item:hover { background: var(--bg-subtle); }
.list-item.selected { background: var(--color-primary-bg); }
.list-item.dragging { opacity: 0.5; background: var(--color-primary-bg); }
.col-checkbox { width: 24px; flex-shrink: 0; }
.col-drag { width: 20px; flex-shrink: 0; }
.col-compare { width: 28px; flex-shrink: 0; }
.col-name { flex: 1; min-width: 0; overflow: hidden; }
.col-nav { width: 65px; flex-shrink: 0; text-align: right; }
.col-change { width: 60px; flex-shrink: 0; text-align: right; font-weight: 600; font-size: 12px; }
.col-action { width: 30px; flex-shrink: 0; display: flex; justify-content: flex-end; }
.fund-name { color: var(--text-primary); font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fund-code { color: var(--text-tertiary); font-size: 11px; margin-top: 1px; }
.nav-value { color: var(--text-primary); font-size: 12px; font-weight: 500; }
.nav-date { color: var(--text-tertiary); font-size: 10px; margin-top: 1px; }
.change-up { color: var(--color-danger); }
.change-down { color: var(--color-success); }
.change-flat { color: var(--text-tertiary); }

.drag-handle { cursor: grab; color: var(--text-tertiary); font-size: 14px; user-select: none; }
.drag-handle:active { cursor: grabbing; }
.list-item.in-compare { background: var(--color-primary-bg); }
</style>
