export interface MAConfig {
  period: number
  color: string
  label: string
}

export const MA_PRESETS: MAConfig[] = [
  { period: 5, color: '#f59e0b', label: 'MA5' },
  { period: 10, color: '#ec4899', label: 'MA10' },
  { period: 20, color: '#8b5cf6', label: 'MA20' },
  { period: 30, color: '#06b6d4', label: 'MA30' },
  { period: 60, color: '#10b981', label: 'MA60' },
  { period: 120, color: '#f97316', label: 'MA120' },
  { period: 250, color: '#ef4444', label: 'MA250' },
]

export function calcMA(period: number, values: number[]): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(null); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j]
    }
    result.push(+(sum / period).toFixed(2))
  }
  return result
}
