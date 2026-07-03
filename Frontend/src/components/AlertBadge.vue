<template>
  <div class="alert-badge-wrapper" ref="wrapperRef">
    <button class="alert-bell" @click="toggle" :title="`${t('alert.settings')} (${unreadCount})`">
      <LucideIcon :name="unreadCount > 0 ? 'BellRing' : 'Bell'" :size="18" />
      <span v-if="unreadCount > 0" class="badge-dot">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </button>
    <Transition name="alert-dropdown">
      <div v-if="open" class="alert-dropdown">
        <div class="dropdown-header">
          <span class="dropdown-title">{{ t('alert.list') }}</span>
          <BButton circle size="small" @click="close">&times;</BButton>
        </div>
        <div class="dropdown-body">
          <div v-if="store.rules.length === 0" class="empty-state">{{ t('alert.empty') }}</div>
          <div v-for="rule in store.rules" :key="rule.id" class="rule-item">
            <div class="rule-info">
              <span class="rule-fund">{{ rule.fund_code }}</span>
              <span class="rule-type" :class="rule.alert_type">{{ typeLabel(rule.alert_type) }}</span>
              <span class="rule-threshold">{{ rule.threshold }}%</span>
            </div>
            <BSwitch :modelValue="!!rule.enabled" @update:modelValue="v => toggleRule(rule, v)" size="small" />
          </div>
        </div>
        <div class="dropdown-footer">
          <BButton type="primary" size="small" @click="refreshCheck" :disabled="store.loading">
            <LucideIcon name="RefreshCw" :size="14" :class="{ spinning: store.loading }" /> {{ t('alert.check') }}
          </BButton>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import BButton from './BButton.vue'
import BSwitch from './BSwitch.vue'
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAlertStore } from '../stores/alertStore'
import { useNotification } from '../composables/useNotification'

const { t } = useI18n()

const store = useAlertStore()
const { notifyAlert } = useNotification()

const open = ref(false)
const wrapperRef = ref<HTMLElement | null>(null)

const unreadCount = ref(0)

const typeLabel = (type: string) => {
  const labels: Record<string, string> = { price_up: t('alert.priceUp'), price_down: t('alert.priceDown'), return_above: t('alert.returnAbove'), return_below: t('alert.returnBelow') }
  return labels[type] || type
}

const toggle = () => { open.value = !open.value }
const close = () => { open.value = false }

const toggleRule = async (rule: { id: number }, val: boolean) => {
  await store.update(rule.id, { enabled: val ? 1 : 0 })
}

const refreshCheck = async () => {
  const triggered = await store.check()
  if (triggered && triggered.length > 0) {
    unreadCount.value += triggered.length
  }
}

function handleClickOutside(e: MouseEvent) {
  if (open.value && wrapperRef.value && !wrapperRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  document.addEventListener('mousedown', handleClickOutside)
  await store.fetch()
  const triggered = await store.check()
  if (triggered && triggered.length > 0) {
    unreadCount.value = triggered.length
  }
  pollTimer = setInterval(refreshCheck, 60000)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<style scoped>
.alert-badge-wrapper { position: relative; }

.alert-bell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
  color: white;
}

.alert-bell:hover { background: rgba(255, 255, 255, 0.28); }

.badge-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: var(--color-danger);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
}

.alert-dropdown {
  position: absolute;
  top: 44px;
  right: 0;
  width: 320px;
  max-height: 400px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 200;
  display: flex;
  flex-direction: column;
}

.dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
}

.dropdown-title { font-weight: 600; font-size: 14px; color: var(--text-primary); }
.dropdown-body { flex: 1; overflow-y: auto; padding: 8px; }
.empty-state { text-align: center; color: var(--text-tertiary); padding: 24px; font-size: 13px; }

.rule-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  transition: background 0.2s;
  cursor: default;
}
.rule-item:hover { background: var(--bg-hover); }

.rule-info { display: flex; gap: 8px; align-items: center; font-size: 13px; }
.rule-fund { font-weight: 600; color: var(--text-primary); }
.rule-type { padding: 1px 6px; border-radius: 4px; font-size: 11px; }
.rule-type.price_up, .rule-type.return_above { background: var(--color-danger-bg); color: var(--color-danger); }
.rule-type.price_down, .rule-type.return_below { background: var(--color-success-bg); color: var(--color-success); }
.rule-threshold { color: var(--text-tertiary); }


.dropdown-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--border-default);
  display: flex;
  justify-content: center;
}

.alert-dropdown-enter-active, .alert-dropdown-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.alert-dropdown-enter-from, .alert-dropdown-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
