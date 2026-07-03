<template>
  <div v-if="hasError" class="error-boundary">
    <LucideIcon name="AlertTriangle" :size="24" />
    <p>{{ t('error.renderError') }}</p>
    <BButton plain @click="retry">{{ t('common.retry') }}</BButton>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import BButton from './BButton.vue'
import { ref, onErrorCaptured } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const hasError = ref(false)

onErrorCaptured((err: Error) => {
  console.error('[ErrorBoundary]', err)
  hasError.value = true
  return false
})

function retry() {
  hasError.value = false
}
</script>

<style scoped>
.error-boundary {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  color: var(--text-secondary);
  text-align: center;
}

.error-boundary p {
  margin: 0;
  font-size: 14px;
}

</style>
