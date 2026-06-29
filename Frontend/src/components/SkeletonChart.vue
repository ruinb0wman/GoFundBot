<template>
  <div class="skeleton-chart" :style="{ height: height + 'px' }">
    <div class="skeleton-chart-area">
      <svg class="skeleton-chart-svg" :width="width" :height="height - 40" viewBox="0 0 300 160">
        <path
          d="M10,140 Q40,130 70,120 T130,80 T190,60 T250,30 T290,20"
          fill="none"
          stroke="var(--border-default, #ddd)"
          stroke-width="2"
          stroke-dasharray="4 4"
        />
      </svg>
    </div>
    <div class="skeleton-chart-legend">
      <div class="skeleton-line" style="width: 80px" />
      <div class="skeleton-line" style="width: 80px" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  height?: number
  width?: number
}>(), {
  height: 300,
  width: 300,
})
</script>

<style scoped>
.skeleton-chart {
  padding: 16px;
  border-radius: 8px;
  background: var(--bg-card, #fff);
}

.skeleton-chart-svg {
  width: 100%;
  height: auto;
}

.skeleton-chart-legend {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-top: 8px;
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--bg-subtle, #f0f0f0) 25%, var(--bg-hover, #e8e8e8) 50%, var(--bg-subtle, #f0f0f0) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
