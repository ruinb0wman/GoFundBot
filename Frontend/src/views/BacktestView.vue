<template>
  <FundBacktest :fundCode="fundCode" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import FundBacktest from '../components/FundBacktest.vue'

const route = useRoute()
const fundCode = computed(() => String(route.params.code || ''))
</script>
