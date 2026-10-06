<template>
  <div class="portfolio-page">
    <div class="portfolio-tabs">
      <button class="portfolio-tab" :class="{ active: tab === 'realtime' }" @click="tab = 'realtime'">
        <LucideIcon name="BarChart3" :size="15" /> {{ '实时估值' }}
      </button>
      <button class="portfolio-tab" :class="{ active: tab === 'positions' }" @click="tab = 'positions'">
        <LucideIcon name="Wallet" :size="15" /> {{ '持仓管理' }}
      </button>
    </div>
    <FundRealtime v-show="tab === 'realtime'" @view-detail="$emit('view-detail', $event)" />
    <MyPositions v-show="tab === 'positions'" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { LucideIcon } from '@gofund/ui'
import FundRealtime from '../components/FundRealtime.vue'
import MyPositions from '../components/MyPositions.vue'

defineOptions({ name: 'PortfolioView' })

defineEmits<{
  'view-detail': [code: string]
}>()

const tab = ref<'realtime' | 'positions'>('realtime')
</script>

<style scoped>
.portfolio-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.portfolio-tabs {
  display: flex;
  gap: 8px;
}

.portfolio-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
}

.portfolio-tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--text-inverse);
}
</style>
