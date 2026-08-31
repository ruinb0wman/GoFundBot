<template>
  <div class="skeleton-card" :style="cardStyle">
    <div v-if="title" class="skeleton-line skeleton-title" style="width: 60%" />
    <div
      v-for="i in lines"
      :key="i"
      class="skeleton-line"
      :style="{ width: widths?.[i - 1] || '100%' }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'SkeletonCard' })

const props = withDefaults(defineProps<{
  lines?: number
  widths?: string[] | null
  height?: number
  title?: boolean
}>(), {
  lines: 3,
  widths: null,
  height: 120,
  title: false,
})

const cardStyle = computed(() => ({ height: props.height + 'px' }))
</script>

<style scoped>
.skeleton-card {
  padding: 16px;
  border-radius: 8px;
  background: var(--bg-card, #fff);
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  margin-bottom: 10px;
  background: linear-gradient(90deg, var(--bg-subtle, #f0f0f0) 25%, var(--bg-hover, #e8e8e8) 50%, var(--bg-subtle, #f0f0f0) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-title {
  height: 16px;
  margin-bottom: 14px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
