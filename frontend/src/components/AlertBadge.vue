<template>
  <RAlertBell
    :items="items"
    :unread-count="unreadCount"
    solid
    @toggle="toggleRule"
    @update:open="onOpenChange"
  >
    <template #footer>
      <RButton type="primary" size="small" :disabled="store.loading" @click="refreshCheck">
        <RLucideIcon name="RefreshCw" :size="14" :class="{ spinning: store.loading }" /> {{ '检查' }}
      </RButton>
    </template>
  </RAlertBell>
</template>

<script setup lang="ts">
/**
 * 告警铃铛的 GoFundBot 胶水层：把 alertStore 的数据映射成 RAlertBell 的 props，
 * 组件本体（铃铛 + 下拉面板）在 @ruinb0w/ui 里，不认识 store。
 */
import { RAlertBell, RButton, RLucideIcon } from '@ruinb0w/ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAlertStore } from '../stores/alertStore'

const store = useAlertStore()
const unreadCount = ref(0)

const typeLabel: Record<string, { text: string; tone: 'danger' | 'success' }> = {
  price_up: { text: '涨超', tone: 'danger' },
  price_down: { text: '跌超', tone: 'success' },
  return_above: { text: '收益大于', tone: 'danger' },
  return_below: { text: '收益小于', tone: 'success' },
}

const items = computed(() =>
  store.rules.map((rule) => ({
    id: rule.id,
    title: rule.fund_code,
    badge: typeLabel[rule.alert_type],
    note: `${rule.threshold}%`,
    enabled: !!rule.enabled,
  })),
)

const toggleRule = async (id: string | number, enabled: boolean) => {
  await store.update(Number(id), { enabled: enabled ? 1 : 0 })
}

const refreshCheck = async () => {
  const triggered = await store.check()
  if (triggered?.length) unreadCount.value += triggered.length
}

const onOpenChange = (open: boolean) => {
  if (open && unreadCount.value) unreadCount.value = 0
}

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await store.fetch()
  const triggered = await store.check()
  if (triggered?.length) unreadCount.value = triggered.length
  pollTimer = setInterval(refreshCheck, 60000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>
