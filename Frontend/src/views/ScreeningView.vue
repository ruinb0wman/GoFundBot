<template>
  <FundScreening @view-fund="$emit('view-fund', $event)" />
</template>

<script setup lang="ts">
import FundScreening from '../components/FundScreening.vue'

defineEmits<{
  'view-fund': [code: string]
}>()
</script>
