<template>
  <ResearchDashboard @view-fund="$emit('view-fund', $event)" />
</template>

<script setup lang="ts">
import ResearchDashboard from '../components/ResearchDashboard.vue'

defineEmits<{
  'view-fund': [code: string]
}>()
</script>
