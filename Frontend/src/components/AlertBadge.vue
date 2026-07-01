<template>
  <div class="alert-badge-wrapper" ref="wrapperRef">
    <button class="alert-bell" @click="toggle" :title="`告警 (${unreadCount})`">
      <LucideIcon :name="unreadCount > 0 ? 'BellRing' : 'Bell'" :size="18" />
      <span v-if="unreadCount > 0" class="badge-dot">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </button>
    <Transition name="alert-dropdown">
      <div v-if="open" class="alert-dropdown">
        <div class="dropdown-header">
          <span class="dropdown-title">告警列表</span>
          <button class="close-btn" @click="close">&times;</button>
        </div>
        <div class="dropdown-body">
          <div v-if="store.rules.length === 0" class="empty-state">暂无告警规则</div>
          <div v-for="rule in store.rules" :key="rule.id" class="rule-item">
            <div class="rule-info">
              <span class="rule-fund">{{ rule.fund_code }}</span>
              <span class="rule-type" :class="rule.alert_type">{{ typeLabel(rule.alert_type) }}</span>
              <span class="rule-threshold">{{ rule.threshold }}%</span>
            </div>
            <label class="toggle-label">
              <input type="checkbox" :checked="rule.enabled" @change="toggleRule(rule)" />
              <span class="toggle-track"></span>
            </label>
          </div>
        </div>
        <div class="dropdown-footer">
          <button class="btn-check" @click="refreshCheck" :disabled="store.loading">
            <LucideIcon name="RefreshCw" :size="14" :class="{ spinning: store.loading }" /> 检查
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAlertStore } from '../stores/alertStore'
import { useNotification } from '../composables/useNotification'

const store = useAlertStore()
const { notifyAlert } = useNotification()

const open = ref(false)
const wrapperRef = ref<HTMLElement | null>(null)

const unreadCount = ref(0)

const typeLabel = (t: string) => {
  const labels: Record<string, string> = { price_up: '涨超', price_down: '跌超', return_above: '收益上', return_below: '收益下' }
  return labels[t] || t
}

const toggle = () => { open.value = !open.value }
const close = () => { open.value = false }

const toggleRule = async (rule: { id: number; enabled: boolean }) => {
  await store.update(rule.id, { enabled: rule.enabled ? 0 : 1 })
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
.close-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-tertiary); }
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

.toggle-label { display: flex; align-items: center; cursor: pointer; }
.toggle-label input { display: none; }
.toggle-track {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--border-default);
  position: relative;
  transition: background 0.2s;
}
.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.toggle-label input:checked + .toggle-track { background: var(--color-primary); }
.toggle-label input:checked + .toggle-track::after { transform: translateX(14px); }

.dropdown-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--border-default);
  display: flex;
  justify-content: center;
}

.btn-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: var(--color-primary);
  color: var(--text-inverse);
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-check:hover { opacity: 0.9; }
.btn-check:disabled { opacity: 0.6; cursor: not-allowed; }

.spinning { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.alert-dropdown-enter-active, .alert-dropdown-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.alert-dropdown-enter-from, .alert-dropdown-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
