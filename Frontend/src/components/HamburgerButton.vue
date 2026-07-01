<template>
  <button class="hamburger-btn" :class="{ active: isOpen }" @click="$emit('toggle')" :aria-label="t('common.menu')">
    <span class="hamburger-line" />
    <span class="hamburger-line" />
    <span class="hamburger-line" />
  </button>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
defineProps<{ isOpen: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<style scoped>
.hamburger-btn {
  display: none;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: background 0.2s;
}

.hamburger-btn:hover {
  background: var(--bg-subtle);
}

.hamburger-line {
  display: block;
  width: 20px;
  height: 2px;
  background: var(--text-primary);
  border-radius: 2px;
  transition: all 0.3s ease;
}

.hamburger-btn.active .hamburger-line:nth-child(1) {
  transform: translateY(6px) rotate(45deg);
}

.hamburger-btn.active .hamburger-line:nth-child(2) {
  opacity: 0;
}

.hamburger-btn.active .hamburger-line:nth-child(3) {
  transform: translateY(-6px) rotate(-45deg);
}

@media (max-width: 1024px) {
  .hamburger-btn {
    display: flex;
  }
}
</style>
