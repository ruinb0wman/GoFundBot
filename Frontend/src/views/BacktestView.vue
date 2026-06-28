<template>
  <FundBacktest :fundCode="fundCode" />
</template>

<script>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import FundBacktest from '../components/FundBacktest.vue'

export default {
  components: { FundBacktest },
  setup() {
    const route = useRoute()
    const fundCode = computed(() => route.params.code || '')
    return { fundCode }
  }
}
</script>
