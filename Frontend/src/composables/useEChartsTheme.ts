import * as echarts from 'echarts'
import { watch, ref, type Ref } from 'vue'
import { useTheme } from './useTheme'

let registered = false

interface EChartsTheme {
  color: string[]
  backgroundColor: string
  textStyle: { color: string }
  title: { textStyle: { color: string } }
  legend: { textStyle: { color: string } }
  axisLine: { lineStyle: { color: string } }
  axisLabel: { color: string }
  splitLine: { lineStyle: { color: string } }
  tooltip: {
    backgroundColor: string
    borderColor: string
    textStyle: { color: string }
  }
}

function buildLightTheme(): EChartsTheme {
  return {
    color: ['#1677ff', '#52c41a', '#faad14', '#ff4d4f', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#bfbfbf'],
    backgroundColor: '#ffffff',
    textStyle: { color: '#6b7280' },
    title: { textStyle: { color: '#1f2937' } },
    legend: { textStyle: { color: '#6b7280' } },
    axisLine: { lineStyle: { color: '#e5e7eb' } },
    axisLabel: { color: '#6b7280' },
    splitLine: { lineStyle: { color: '#f0f0f0' } },
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: '#e5e7eb',
      textStyle: { color: '#1f2937' },
    },
  }
}

function buildDarkTheme(): EChartsTheme {
  return {
    color: ['#a8b1ff', '#3dd68c', '#f9b44e', '#f66f81', '#38bdf8', '#c8abfa', '#fb923c', '#f67373', '#f0abfc', '#6a6a71'],
    backgroundColor: '#202127',
    textStyle: { color: '#98989f' },
    title: { textStyle: { color: '#dfdfd6' } },
    legend: { textStyle: { color: '#98989f' } },
    axisLine: { lineStyle: { color: '#2e2e32' } },
    axisLabel: { color: '#98989f' },
    splitLine: { lineStyle: { color: '#2e2e32' } },
    tooltip: {
      backgroundColor: 'rgba(32,33,39,0.96)',
      borderColor: '#3c3f44',
      textStyle: { color: '#dfdfd6' },
    },
  }
}

function registerThemes(): void {
  if (registered) return
  echarts.registerTheme('gofund-light', buildLightTheme())
  echarts.registerTheme('gofund-dark', buildDarkTheme())
  registered = true
}

registerThemes()

const { theme } = useTheme()
const echartThemeName: Ref<string> = ref(theme.value === 'dark' ? 'gofund-dark' : 'gofund-light')

watch(theme, (val) => {
  echartThemeName.value = val === 'dark' ? 'gofund-dark' : 'gofund-light'
})

export function useEChartsTheme(): { echartThemeName: Ref<string> } {
  return { echartThemeName }
}
