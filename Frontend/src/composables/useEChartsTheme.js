import * as echarts from 'echarts'
import { watch, ref } from 'vue'
import { useTheme } from './useTheme'

let registered = false

function buildLightTheme() {
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
      textStyle: { color: '#1f2937' }
    }
  }
}

function buildDarkTheme() {
  return {
    color: ['#3b82f6', '#4ade80', '#fbbf24', '#f87171', '#38bdf8', '#34d399', '#fb923c', '#c084fc', '#f0abfc', '#787878'],
    backgroundColor: '#1a1d2b',
    textStyle: { color: '#94a3b8' },
    title: { textStyle: { color: '#e2e8f0' } },
    legend: { textStyle: { color: '#94a3b8' } },
    axisLine: { lineStyle: { color: '#2a3040' } },
    axisLabel: { color: '#94a3b8' },
    splitLine: { lineStyle: { color: '#232738' } },
    tooltip: {
      backgroundColor: 'rgba(26,29,43,0.96)',
      borderColor: '#2a3040',
      textStyle: { color: '#e2e8f0' }
    }
  }
}

function registerThemes() {
  if (registered) return
  echarts.registerTheme('gofund-light', buildLightTheme())
  echarts.registerTheme('gofund-dark', buildDarkTheme())
  registered = true
}

registerThemes()

const { theme } = useTheme()
const echartThemeName = ref(theme.value === 'dark' ? 'gofund-dark' : 'gofund-light')

watch(theme, (val) => {
  echartThemeName.value = val === 'dark' ? 'gofund-dark' : 'gofund-light'
})

export function useEChartsTheme() {
  return { echartThemeName }
}
