<template>
  <div class="alert-settings-overlay" v-if="visible" @mousedown.self="close">
    <div class="alert-settings-dialog">
      <div class="dialog-header">
        <h3><LucideIcon name="Bell" :size="18" /> {{ t('alert.settingsTitle', { code: fundCode }) }}</h3>
        <button class="close-btn" @click="close">&times;</button>
      </div>
      <div class="dialog-body">
        <div v-if="existing.length > 0" class="current-rules">
          <label class="section-label">{{ t('alert.currentRules') }}</label>
          <div v-for="rule in existing" :key="rule.id" class="rule-row">
            <span class="rule-type">{{ typeLabel(rule.alert_type) }} {{ rule.threshold }}%</span>
            <label class="toggle-label">
              <input type="checkbox" :checked="rule.enabled" @change="toggleRule(rule)" />
              <span class="toggle-track"></span>
            </label>
            <button class="btn-delete" @click="deleteRule(rule.id)">&times;</button>
          </div>
        </div>
        <div class="new-rule">
          <label class="section-label">{{ t('alert.addNewRule') }}</label>
          <div class="form-row">
            <select v-model="newType" class="form-select">
              <option value="price_up">{{ t('alert.priceUp') }}</option>
              <option value="price_down">{{ t('alert.priceDown') }}</option>
              <option value="return_above">{{ t('alert.returnAbove') }}</option>
              <option value="return_below">{{ t('alert.returnBelow') }}</option>
            </select>
            <input v-model="newThreshold" type="number" step="0.1" min="0.1" max="1000"
                   :placeholder="t('alert.threshold')" class="form-input" />
            <button class="btn-add" @click="addRule" :disabled="!newThreshold">{{ t('alert.addBtn') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAlertStore } from '../stores/alertStore'

const { t } = useI18n()

const props = defineProps<{ fundCode: string; visible: boolean }>()
const emit = defineEmits(['close'])

const store = useAlertStore()
const newType = ref('price_up')
const newThreshold = ref('')

const existing = computed(() => store.rulesByFund(props.fundCode))

const typeLabel = (type: string) => {
  const labels: Record<string, string> = { price_up: t('alert.priceUp'), price_down: t('alert.priceDown'), return_above: t('alert.returnAbove'), return_below: t('alert.returnBelow') }
  return labels[type] || type
}

const close = () => emit('close')

const toggleRule = async (rule: { id: number; enabled: boolean }) => {
  await store.update(rule.id, { enabled: rule.enabled ? 0 : 1 })
}

const deleteRule = async (id: number) => {
  await store.remove(id)
}

const addRule = async () => {
  if (!newThreshold.value) return
  await store.create({ fund_code: props.fundCode, alert_type: newType.value, threshold: parseFloat(newThreshold.value) })
  newThreshold.value = ''
}

watch(() => props.visible, (v) => {
  if (v) store.fetch()
})
</script>

<style scoped>
.alert-settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-overlay);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.alert-settings-dialog {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 380px;
  max-width: 90vw;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-default);
}

.dialog-header h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  font-size: 22px;
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 0 4px;
}

.dialog-body { padding: 16px 20px; }
.section-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-tertiary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }

.current-rules { margin-bottom: 16px; }

.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
}

.rule-row:hover { background: var(--bg-hover); }

.rule-type { flex: 1; color: var(--text-primary); }

.toggle-label { display: flex; align-items: center; cursor: pointer; }
.toggle-label input { display: none; }
.toggle-track {
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: var(--border-default);
  position: relative;
  transition: background 0.2s;
}
.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.toggle-label input:checked + .toggle-track { background: var(--color-primary); }
.toggle-label input:checked + .toggle-track::after { transform: translateX(12px); }

.btn-delete {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
  line-height: 1;
}
.btn-delete:hover { color: var(--color-danger); }

.new-rule { border-top: 1px solid var(--border-subtle); padding-top: 12px; }

.form-row { display: flex; gap: 8px; }

.form-select {
  flex: 2;
  padding: 6px 8px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-card);
  color: var(--text-primary);
}

.form-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-card);
  color: var(--text-primary);
  width: 80px;
}

.btn-add {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: var(--color-primary);
  color: var(--text-inverse);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.btn-add:hover { opacity: 0.9; }
.btn-add:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
