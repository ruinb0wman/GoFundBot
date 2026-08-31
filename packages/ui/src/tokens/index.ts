/**
 * 设计 token TypeScript 常量
 * 与 tokens/light.css、tokens/dark.css 保持同步（单一数据源）
 * 用途：ECharts 主题、JS 侧颜色逻辑等无法直接读取 CSS 变量的场景
 */

export interface DesignTokens {
  colorPrimary: string
  colorPrimaryHover: string
  colorSuccess: string
  colorDanger: string
  colorWarning: string
  colorInfo: string
  bgPage: string
  bgCard: string
  bgHover: string
  bgSubtle: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  textDisabled: string
  borderDefault: string
  borderSubtle: string
  chartColors: string[]
  chartBg: string
  chartGrid: string
  chartAxisLabel: string
}

export const lightTokens: DesignTokens = {
  colorPrimary: '#1677ff',
  colorPrimaryHover: '#0958d9',
  colorSuccess: '#52c41a',
  colorDanger: '#ff4d4f',
  colorWarning: '#faad14',
  colorInfo: '#13c2c2',
  bgPage: '#f5f7fa',
  bgCard: '#ffffff',
  bgHover: '#f0f2f5',
  bgSubtle: '#f3f4f6',
  textPrimary: '#1f2937',
  textSecondary: '#6b7280',
  textTertiary: '#9ca3af',
  textDisabled: '#d1d5db',
  borderDefault: '#e5e7eb',
  borderSubtle: '#f0f0f0',
  chartColors: ['#1677ff', '#52c41a', '#faad14', '#ff4d4f', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#bfbfbf'],
  chartBg: '#ffffff',
  chartGrid: '#e5e7eb',
  chartAxisLabel: '#6b7280',
}

export const darkTokens: DesignTokens = {
  colorPrimary: '#a8b1ff',
  colorPrimaryHover: '#5c73e7',
  colorSuccess: '#3dd68c',
  colorDanger: '#f66f81',
  colorWarning: '#f9b44e',
  colorInfo: '#5c73e7',
  bgPage: '#1b1b1f',
  bgCard: '#202127',
  bgHover: '#2a2b31',
  bgSubtle: '#161618',
  textPrimary: '#dfdfd6',
  textSecondary: '#98989f',
  textTertiary: '#6a6a71',
  textDisabled: '#4a4a52',
  borderDefault: '#3c3f44',
  borderSubtle: '#2e2e32',
  chartColors: ['#a8b1ff', '#3dd68c', '#f9b44e', '#f66f81', '#38bdf8', '#c8abfa', '#fb923c', '#f67373', '#f0abfc', '#6a6a71'],
  chartBg: '#202127',
  chartGrid: '#2e2e32',
  chartAxisLabel: '#98989f',
}

export type ThemeMode = 'light' | 'dark'

export function getTokens(mode: ThemeMode): DesignTokens {
  return mode === 'dark' ? darkTokens : lightTokens
}
