<template>
  <Transition name="offline-fade">
    <div v-if="!isOnline" class="offline-banner">
      <LucideIcon name="WifiOff" :size="16" />
      <span>{{ '网络已断开，部分功能不可用' }}</span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useOnlineStatus } from '../composables/useOnlineStatus'

const { isOnline } = useOnlineStatus()
</script>

<style scoped>
.offline-banner {
  position: sticky;
  top: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--color-danger, #e74c3c);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}

.offline-fade-enter-active,
.offline-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.offline-fade-enter-from,
.offline-fade-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}
</style>
