<template>
  <div class="settings-anomaly">
    <h3 class="page-title"><LucideIcon name="BellRing" :size="22" /> {{ t('settings.anomaly.title') }}</h3>

    <div v-if="loading" class="loading-state">{{ t('common.loading') }}</div>

    <template v-else>
      <section class="config-section">
        <h4 class="section-title">{{ t('settings.anomaly.indexSection') }}</h4>
        <div class="config-row">
          <label>{{ t('settings.anomaly.indexSurge') }}</label>
          <BInputNumber v-model="form.index_surge_threshold" size="small" :min="0.1" :max="20" :step="0.1" />
        </div>
        <div class="config-row">
          <label>{{ t('settings.anomaly.indexPlunge') }}</label>
          <BInputNumber v-model="form.index_plunge_threshold" size="small" :min="-20" :max="-0.1" :step="0.1" />
        </div>
      </section>

      <section class="config-section">
        <h4 class="section-title">{{ t('settings.anomaly.volumeSection') }}</h4>
        <div class="config-row">
          <label>{{ t('settings.anomaly.volumeSurge') }}</label>
          <BInputNumber v-model="form.volume_surge_ratio" size="small" :min="1.1" :max="10" :step="0.1" />
        </div>
        <div class="config-row">
          <label>{{ t('settings.anomaly.volumeShrink') }}</label>
          <BInputNumber v-model="form.volume_shrink_ratio" size="small" :min="0.05" :max="0.95" :step="0.05" />
        </div>
      </section>

      <section class="config-section">
        <h4 class="section-title">{{ t('settings.anomaly.sectorSection') }}</h4>
        <div class="config-row">
          <label>{{ t('settings.anomaly.sectorSurge') }}</label>
          <BInputNumber v-model="form.sector_surge_threshold" size="small" :min="0.1" :max="20" :step="0.1" />
        </div>
        <div class="config-row">
          <label>{{ t('settings.anomaly.sectorPlunge') }}</label>
          <BInputNumber v-model="form.sector_plunge_threshold" size="small" :min="-20" :max="-0.1" :step="0.1" />
        </div>
        <div class="config-row">
          <label>{{ t('settings.anomaly.sectorInflow') }}</label>
          <BInputNumber v-model="form.sector_inflow_threshold" size="small" :min="0" :max="1000" :step="1" />
        </div>
      </section>

      <section class="config-section">
        <h4 class="section-title">{{ t('settings.anomaly.northSection') }}</h4>
        <div class="config-row">
          <label>{{ t('settings.anomaly.northInflow') }}</label>
          <BInputNumber v-model="form.north_inflow_threshold" size="small" :min="0" :max="500" :step="1" />
        </div>
        <div class="config-row">
          <label>{{ t('settings.anomaly.northOutflow') }}</label>
          <BInputNumber v-model="form.north_outflow_threshold" size="small" :min="-500" :max="-1" :step="1" />
        </div>
      </section>

      <div class="actions">
        <BButton type="primary" :disabled="saving" @click="saveConfig">
          <LucideIcon name="Save" :size="16" /> {{ t('settings.anomaly.save') }}
        </BButton>
        <BButton :disabled="saving" @click="resetDefaults">
          <LucideIcon name="RotateCcw" :size="16" /> {{ t('settings.anomaly.resetDefaults') }}
        </BButton>
      </div>

      <div v-if="message" class="message" :class="messageType">{{ message }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import BButton from '../components/BButton.vue'
import BInputNumber from '../components/BInputNumber.vue'
import LucideIcon from '../components/LucideIcon.vue'
import { anomalyConfigAPI } from '../services/api'

const { t } = useI18n()

interface AnomalyForm {
  index_surge_threshold: number
  index_plunge_threshold: number
  volume_surge_ratio: number
  volume_shrink_ratio: number
  sector_surge_threshold: number
  sector_plunge_threshold: number
  sector_inflow_threshold: number
  north_inflow_threshold: number
  north_outflow_threshold: number
}

const defaults: AnomalyForm = {
  index_surge_threshold: 3.0,
  index_plunge_threshold: -3.0,
  volume_surge_ratio: 1.5,
  volume_shrink_ratio: 0.5,
  sector_surge_threshold: 5.0,
  sector_plunge_threshold: -5.0,
  sector_inflow_threshold: 10.0,
  north_inflow_threshold: 100.0,
  north_outflow_threshold: -50.0,
}

const form = ref<AnomalyForm>({ ...defaults })
const loading = ref(true)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const loadConfig = async () => {
  loading.value = true
  try {
    const res = await anomalyConfigAPI.get()
    const data = res.data as Partial<AnomalyForm>
    for (const key of Object.keys(defaults) as (keyof AnomalyForm)[]) {
      if (data[key] !== undefined && typeof data[key] === 'number') {
        form.value[key] = data[key]!
      }
    }
  } catch {
    message.value = t('settings.anomaly.saveFailed')
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

const saveConfig = async () => {
  saving.value = true
  message.value = ''
  try {
    await anomalyConfigAPI.update({ ...form.value })
    message.value = t('settings.anomaly.saved')
    messageType.value = 'success'
  } catch {
    message.value = t('settings.anomaly.saveFailed')
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

const resetDefaults = async () => {
  saving.value = true
  try {
    const res = await anomalyConfigAPI.getDefaults()
    const data = res.data as Partial<AnomalyForm>
    for (const key of Object.keys(defaults) as (keyof AnomalyForm)[]) {
      if (data[key] !== undefined && typeof data[key] === 'number') {
        form.value[key] = data[key]!
      }
    }
    message.value = t('settings.anomaly.saved')
    messageType.value = 'success'
  } catch {
    form.value = { ...defaults }
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.settings-anomaly {
  padding: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 24px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.loading-state {
  text-align: center;
  padding: 48px;
  color: var(--text-tertiary);
}

.config-section {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.config-section:last-of-type {
  border-bottom: none;
}

.section-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
}

.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  gap: 16px;
}

.config-row label {
  font-size: 13px;
  color: var(--text-primary);
  flex-shrink: 0;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-default);
}

.message {
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

.message.success {
  background: var(--color-success-bg, #f6ffed);
  color: var(--color-success, #52c41a);
  border: 1px solid var(--color-success, #52c41a);
}

.message.error {
  background: var(--color-danger-bg, #fff2f0);
  color: var(--color-danger, #ff4d4f);
  border: 1px solid var(--color-danger, #ff4d4f);
}
</style>
