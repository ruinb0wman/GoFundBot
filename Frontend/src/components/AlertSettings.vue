<template>
  <div class="alert-settings-overlay" v-if="visible" @mousedown.self="close">
    <div class="alert-settings-dialog">
      <div class="dialog-header">
        <h3><LucideIcon name="Bell" :size="18" /> {{ t('alert.settingsTitle', { code: fundCode }) }}</h3>
        <BButton circle size="small" @click="close">&times;</BButton>
      </div>
      <div class="dialog-body">
        <div v-if="existing.length > 0" class="current-rules">
          <label class="section-label">{{ t('alert.currentRules') }}</label>
          <div v-for="rule in existing" :key="rule.id" class="rule-row">
            <span class="rule-type">{{ typeLabel(rule.alert_type) }} {{ rule.threshold }}%</span>
            <BSwitch :modelValue="!!rule.enabled" @update:modelValue="v => toggleRule(rule, v)" size="small" />
            <BButton circle size="small" type="danger" icon="Trash2" @click="deleteRule(rule.id)" />
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
            <BInputNumber v-model="newThreshold" :min="0.1" :max="1000" :step="0.1"
                          :placeholder="t('alert.threshold')" :controls="false" />
            <BButton type="primary" size="small" @click="addRule" :disabled="!newThreshold">{{ t('alert.addBtn') }}</BButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import BButton from './BButton.vue'
import BInputNumber from './BInputNumber.vue'
import BSwitch from './BSwitch.vue'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAlertStore } from '../stores/alertStore'

const { t } = useI18n()

const props = defineProps<{ fundCode: string; visible: boolean }>()
const emit = defineEmits(['close'])

const store = useAlertStore()
const newType = ref('price_up')
const newThreshold = ref<number | null>(null)

const existing = computed(() => store.rulesByFund(props.fundCode))

const typeLabel = (type: string) => {
  const labels: Record<string, string> = { price_up: t('alert.priceUp'), price_down: t('alert.priceDown'), return_above: t('alert.returnAbove'), return_below: t('alert.returnBelow') }
  return labels[type] || type
}

const close = () => emit('close')

const toggleRule = async (rule: { id: number }, val: boolean) => {
  await store.update(rule.id, { enabled: val ? 1 : 0 })
}

const deleteRule = async (id: number) => {
  await store.remove(id)
}

const addRule = async () => {
  if (!newThreshold.value) return
  await store.create({ fund_code: props.fundCode, alert_type: newType.value, threshold: newThreshold.value })
  newThreshold.value = null
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


</style>
