<template>
  <button class="locale-switcher" @click="toggleLocale" :title="toggleLabel">
    <LucideIcon name="Languages" :size="16" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getCurrentLocale, setLocale } from '../locales/index'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const isZh = computed(() => getCurrentLocale().startsWith('zh'))
const toggleLabel = computed(() => isZh.value ? t('i18n.switchTo') : t('i18n.switchToZh'))

function toggleLocale() {
  setLocale(isZh.value ? 'en' : 'zh-CN')
}
</script>

<style scoped>
.locale-switcher {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.locale-switcher:hover {
  background: rgba(255, 255, 255, 0.28);
}
</style>
