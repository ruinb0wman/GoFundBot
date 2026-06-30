// @ts-nocheck
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from './useTheme'
import { useBreakpoint } from './useBreakpoint'

export function useApp() {
  const { theme: appTheme, savedTheme, toggleTheme } = useTheme()
  const { isMobile } = useBreakpoint()
  const drawerOpen = ref(false)
  const currentTime = ref('')
  const route = useRoute()
  const router = useRouter()
  const compareFunds: any = ref([])
  const compareMode = ref(false)

  const showFullContent = computed(() =>
    !!route.params.code || (compareMode.value && compareFunds.value.length >= 2)
  )

  const themeIcon = computed(() => {
    if (savedTheme.value === 'dark') return 'Moon'
    if (savedTheme.value === 'auto') return 'Monitor'
    return 'Sun'
  })

  const themeTitle = computed(() => {
    if (savedTheme.value === 'light') return '浅色模式（点击切换）'
    if (savedTheme.value === 'dark') return '深色模式（点击切换）'
    return '跟随系统（点击切换）'
  })

  const normalizeFundCode = (fundOrCode: any) => {
    if (fundOrCode && typeof fundOrCode === 'object') {
      return fundOrCode.CODE || fundOrCode.fund_code || fundOrCode.code || ''
    }
    return fundOrCode || ''
  }

  const handleNavigate = (fundOrCode: any) => {
    if (compareMode.value) return
    const code = normalizeFundCode(fundOrCode)
    if (code) router.push({ name: 'fund-detail', params: { code } })
  }

  const handleHeaderSearch = (fundOrCode: any) => {
    compareMode.value = false
    const code = normalizeFundCode(fundOrCode)
    if (code) router.push({ name: 'fund-detail', params: { code } })
  }

  const resetToDashboard = () => {
    compareMode.value = false
    compareFunds.value = []
    router.push({ name: 'dashboard' })
  }

  const toggleCompareMode = () => {
    compareMode.value = !compareMode.value
    if (!compareMode.value) compareFunds.value = []
  }

  const handleAddToCompare = (fund: any) => {
    if (compareFunds.value.length >= 5) { alert('最多只能对比5只基金'); return }
    if (compareFunds.value.some((f: any) => f.code === fund.code)) {
      compareFunds.value = compareFunds.value.filter((f: any) => f.code !== fund.code)
      return
    }
    compareFunds.value.push({ code: fund.code, name: fund.name })
  }

  const handleRemoveFromCompare = (fundCode: string) => {
    compareFunds.value = compareFunds.value.filter((f: any) => f.code !== fundCode)
  }

  const handleClearCompare = () => { compareFunds.value = [] }

  const updateTime = () => { currentTime.value = new Date().toLocaleString('zh-CN') }

  onMounted(() => { updateTime(); setInterval(updateTime, 60000) })

  return {
    drawerOpen, currentTime, route, router, isMobile,
    compareFunds, compareMode, showFullContent,
    themeIcon, themeTitle, toggleTheme, toggleCompareMode,
    handleNavigate, handleHeaderSearch, resetToDashboard,
    handleAddToCompare, handleRemoveFromCompare, handleClearCompare
  }
}
