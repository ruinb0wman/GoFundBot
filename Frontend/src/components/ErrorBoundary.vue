<template>
  <div v-if="hasError" class="error-boundary">
    <LucideIcon name="AlertTriangle" :size="24" />
    <p>页面渲染异常</p>
    <button class="error-retry-btn" @click="retry">重试</button>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'

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

.error-retry-btn {
  padding: 8px 24px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.error-retry-btn:hover {
  background: var(--bg-subtle);
  border-color: var(--color-primary);
}
</style>
