<template>
  <FundDetail :fundCode="fundCode" @navigate-to-fund="$emit('navigate-to-fund', $event)" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import FundDetail from '../components/FundDetail.vue'

const route = useRoute()
const fundCode = computed(() => String(route.params.code || ''))

defineEmits<{
  'navigate-to-fund': [code: string]
}>()
</script>
