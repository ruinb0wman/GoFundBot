<template>
  <ResearchDashboard @view-fund="$emit('view-fund', $event)" />
</template>

<script>
import ResearchDashboard from '../components/ResearchDashboard.vue'

export default {
  components: { ResearchDashboard },
  emits: ['view-fund']
}
</script>
