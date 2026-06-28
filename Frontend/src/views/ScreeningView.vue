<template>
  <FundScreening @view-fund="$emit('view-fund', $event)" />
</template>

<script>
import FundScreening from '../components/FundScreening.vue'

export default {
  components: { FundScreening },
  emits: ['view-fund']
}
</script>
