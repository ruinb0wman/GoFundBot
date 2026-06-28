<template>
  <FundDetail :fundCode="fundCode" @navigate-to-fund="$emit('navigate-to-fund', $event)" />
</template>

<script>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import FundDetail from '../components/FundDetail.vue'

export default {
  components: { FundDetail },
  emits: ['navigate-to-fund'],
  setup() {
    const route = useRoute()
    const fundCode = computed(() => route.params.code || '')
    return { fundCode }
  }
}
</script>
