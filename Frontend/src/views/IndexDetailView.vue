<template>
  <IndexDetail :indexCode="indexCode" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import IndexDetail from '../components/IndexDetail.vue'

const route = useRoute()
const indexCode = computed(() => String(route.params.code || ''))
</script>
