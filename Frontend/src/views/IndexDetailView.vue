<template>
  <IndexDetail :indexCode="indexCode" />
</template>

<script>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import IndexDetail from '../components/IndexDetail.vue'

export default {
  components: { IndexDetail },
  setup() {
    const route = useRoute()
    const indexCode = computed(() => route.params.code || '')
    return { indexCode }
  }
}
</script>
