<template>
  <button class="hamburger-btn" :class="{ active: isOpen }" @click="$emit('toggle')" :aria-label="'菜单'">
    <span class="hamburger-line" />
    <span class="hamburger-line" />
    <span class="hamburger-line" />
  </button>
</template>

<script setup lang="ts">
defineProps<{ isOpen: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<style scoped>
/* 可见性由 App.css 的「头部导航阈值」统一控制（≤1400px 显示），
 * 与 .mode-switch 隐藏使用同一个断点，勿在此处再加 media query。 */
.hamburger-btn {
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
</style>
