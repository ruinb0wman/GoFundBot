<template>
  <MarketOverview :showGoldHistory="true" :showSSE30Min="true" />
</template>

<script>
import MarketOverview from '../components/MarketOverview.vue'

export default {
  components: { MarketOverview }
}
</script>
