<script setup lang="ts">
import { computed } from 'vue'
import * as icons from '@lucide/vue'

defineOptions({ name: 'LucideIcon' })

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 20 },
  color: { type: String, default: 'currentColor' },
  strokeWidth: { type: [Number, String], default: 2 },
})

const icon = computed(() => (icons as Record<string, any>)[props.name] || null)
</script>

<template>
  <component
    v-if="icon"
    :is="icon"
    :size="size"
    :color="color"
    :stroke-width="strokeWidth"
  />
  <span v-else class="lucide-icon-fallback">{{ name }}</span>
</template>
