import { ref, computed, onMounted, onUnmounted } from 'vue'

const breakpoints = {
  mobile: 768,
  tablet: 1024,
  smallDesktop: 1200,
  mediumDesktop: 1400,
  largeDesktop: 1600,
} as const

type BreakpointName = keyof typeof breakpoints

const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)

function onResize() {
  width.value = window.innerWidth
}

export function useBreakpoint() {
  onMounted(() => {
    window.addEventListener('resize', onResize)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', onResize)
  })

  const isMobile = computed(() => width.value < breakpoints.mobile)
  const isTablet = computed(() => width.value >= breakpoints.mobile && width.value < breakpoints.tablet)
  const isDesktop = computed(() => width.value >= breakpoints.tablet)

  function isBelow(name: BreakpointName): boolean {
    return width.value < breakpoints[name]
  }

  function isAbove(name: BreakpointName): boolean {
    return width.value >= breakpoints[name]
  }

  return {
    width,
    isMobile,
    isTablet,
    isDesktop,
    isBelow,
    isAbove,
    breakpoints,
  }
}
