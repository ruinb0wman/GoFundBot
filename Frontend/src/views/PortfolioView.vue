<template>
  <FundRealtime @view-detail="$emit('view-detail', $event)" />
</template>

<script>
import FundRealtime from '../components/FundRealtime.vue'

export default {
  components: { FundRealtime },
  emits: ['view-detail']
}
</script>
