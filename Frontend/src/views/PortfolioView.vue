<template>
  <FundRealtime @view-detail="$emit('view-detail', $event)" />
</template>

<script setup lang="ts">
import FundRealtime from '../components/FundRealtime.vue'

defineEmits<{
  'view-detail': [code: string]
}>()
</script>
