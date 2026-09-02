import { onMounted, onUnmounted, type Ref } from 'vue'

export function useChartResize(chartRef: Ref<any>) {
  let handler: (() => void) | null = null

  onMounted(() => {
    handler = () => { chartRef.value?.resize() }
    window.addEventListener('resize', handler)
  })

  onUnmounted(() => {
    if (handler) window.removeEventListener('resize', handler)
  })
}
