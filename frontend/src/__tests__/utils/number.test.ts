import { describe, it, expect } from 'vitest'
import {
  isZero, isFiniteNumber, safeDiv,
  calcReturn, calcAnnualReturn, calcMaxDrawdown,
  calcDailyReturns, calcVolatility, calcSharpe,
  fmtPercent, fmtNumber, fmtMoney, fmtAmountYi,
  fmtChange, fmtRatio, fmtDrawdown,
  returnClass, sharpeClass, scoreClass,
  DEFAULT_RISK_FREE_RATE
} from '../../utils/number'

describe('isZero', () => {
  it('returns true for zero', () => { expect(isZero(0)).toBe(true) })
  it('returns true for tiny values', () => { expect(isZero(1e-13)).toBe(true) })
  it('returns false for non-zero values', () => { expect(isZero(0.1)).toBe(false) })
  it('returns false for NaN', () => { expect(isZero(NaN)).toBe(false) })
  it('returns false for Infinity', () => { expect(isZero(Infinity)).toBe(false) })
  it('respects custom epsilon', () => {
    expect(isZero(0.01, 0.1)).toBe(true)
    expect(isZero(0.01, 0.001)).toBe(false)
  })
})

describe('isFiniteNumber', () => {
  it('returns true for numbers', () => { expect(isFiniteNumber(42)).toBe(true) })
  it('returns true for 0', () => { expect(isFiniteNumber(0)).toBe(true) })
  it('returns false for NaN', () => { expect(isFiniteNumber(NaN)).toBe(false) })
  it('returns false for Infinity', () => { expect(isFiniteNumber(Infinity)).toBe(false) })
  it('returns false for null', () => { expect(isFiniteNumber(null)).toBe(false) })
  it('returns false for undefined', () => { expect(isFiniteNumber(undefined)).toBe(false) })
  it('returns false for strings', () => { expect(isFiniteNumber('42')).toBe(false) })
})

describe('safeDiv', () => {
  it('divides normally', () => { expect(safeDiv(10, 2)).toBe(5) })
  it('returns null for division by zero', () => { expect(safeDiv(10, 0)).toBeNull() })
  it('returns null for division by near-zero', () => { expect(safeDiv(10, 1e-13)).toBeNull() })
  it('returns fallback for division by zero', () => { expect(safeDiv(10, 0, 0)).toBe(0) })
  it('returns null for NaN denominator', () => { expect(safeDiv(10, NaN)).toBeNull() })
  it('handles negative numbers', () => { expect(safeDiv(-10, 2)).toBe(-5) })
  it('handles small decimals precisely', () => {
    expect(safeDiv(1, 3)).toBeCloseTo(0.3333333333, 10)
  })
})

describe('calcReturn', () => {
  it('calculates positive return', () => {
    expect(calcReturn(100, 110)).toBeCloseTo(10, 5)
  })
  it('calculates negative return', () => {
    expect(calcReturn(100, 90)).toBeCloseTo(-10, 5)
  })
  it('returns null for zero start', () => { expect(calcReturn(0, 100)).toBeNull() })
  it('returns null for near-zero start', () => { expect(calcReturn(1e-13, 100)).toBeNull() })
  it('returns null for NaN', () => { expect(calcReturn(NaN, 100)).toBeNull() })
  it('handles zero return', () => {
    expect(calcReturn(100, 100)).toBeCloseTo(0, 10)
  })
  it('handles 100% return', () => {
    expect(calcReturn(100, 200)).toBeCloseTo(100, 5)
  })
  it('avoids floating point errors', () => {
    const result = calcReturn(0.1, 0.2)
    expect(result).toBeCloseTo(100, 10)
  })
})

describe('calcAnnualReturn', () => {
  const nav = [1.0, 1.05, 1.1, 1.08, 1.12, 1.15, 1.2, 1.18, 1.22, 1.25]
  it('calculates annualized return', () => {
    const result = calcAnnualReturn(nav[0], nav[nav.length - 1], nav.length)
    expect(result).not.toBeNull()
    expect(typeof result).toBe('number')
  })
  it('returns null for zero start', () => { expect(calcAnnualReturn(0, 100, 252)).toBeNull() })
  it('returns null for NaN inputs', () => { expect(calcAnnualReturn(NaN, 100, 252)).toBeNull() })
  it('returns null for insufficient days', () => { expect(calcAnnualReturn(1, 2, 1)).toBeNull() })
  it('returns null for total loss > 100%', () => { expect(calcAnnualReturn(1, -0.5, 252)).toBeNull() })
  it('returns null for zero trading days', () => { expect(calcAnnualReturn(1, 2, 0)).toBeNull() })
})

describe('calcMaxDrawdown', () => {
  it('returns null for insufficient data', () => {
    expect(calcMaxDrawdown([1])).toBeNull()
    expect(calcMaxDrawdown([])).toBeNull()
  })
  it('returns 0 for always-rising values', () => {
    expect(calcMaxDrawdown([1, 2, 3, 4, 5])).toBeCloseTo(0, 10)
  })
  it('calculates max drawdown correctly', () => {
    const values = [100, 110, 90, 95, 80, 85]
    const result = calcMaxDrawdown(values)
    expect(result).not.toBeNull()
    expect(result).toBeGreaterThan(0)
  })
  it('handles all-falling values', () => {
    const values = [100, 90, 80, 70]
    const result = calcMaxDrawdown(values)
    const expected = ((100 - 70) / 100) * 100
    expect(result).toBeCloseTo(expected, 5)
  })
})

describe('calcDailyReturns', () => {
  it('returns empty for insufficient data', () => {
    expect(calcDailyReturns([1])).toEqual([])
    expect(calcDailyReturns([])).toEqual([])
  })
  it('calculates period returns', () => {
    const result = calcDailyReturns([100, 110, 99])
    expect(result).toHaveLength(2)
    expect(result[0]).toBeCloseTo(0.1, 10)
    expect(result[1]).toBeCloseTo(-0.1, 10)
  })
  it('skips zero previous values', () => {
    const result = calcDailyReturns([100, 0, 110])
    expect(result).toHaveLength(1)
    expect(result[0]).toBeCloseTo(-1, 10)
  })
})

describe('calcVolatility', () => {
  it('returns null for insufficient data', () => {
    expect(calcVolatility([0.01, 0.02])).toBeNull()
    expect(calcVolatility([])).toBeNull()
  })
  it('returns 0 for constant returns', () => {
    const returns = new Array(20).fill(0.01)
    const result = calcVolatility(returns)
    expect(result).toBeCloseTo(0, 8)
  })
  it('calculates positive volatility', () => {
    const returns = [0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.02, -0.02]
    const result = calcVolatility(returns)
    expect(result).not.toBeNull()
    expect(result).toBeGreaterThan(0)
  })
})

describe('calcSharpe', () => {
  it('calculates sharpe ratio', () => {
    const result = calcSharpe(15, 10)
    expect(result).not.toBeNull()
    expect(result).toBeCloseTo((15 - 2) / 10, 10)
  })
  it('returns null for zero volatility', () => {
    expect(calcSharpe(10, 0)).toBeNull()
  })
  it('returns null for near-zero volatility', () => {
    expect(calcSharpe(10, 1e-13)).toBeNull()
  })
  it('returns null for null inputs', () => {
    expect(calcSharpe(null, 10)).toBeNull()
    expect(calcSharpe(10, null)).toBeNull()
    expect(calcSharpe(undefined, 10)).toBeNull()
  })
  it('uses custom risk-free rate', () => {
    const result = calcSharpe(15, 10, 3)
    expect(result).toBeCloseTo((15 - 3) / 10, 10)
  })
  it('returns numerical value without floating point artifacts', () => {
    const result = calcSharpe(15.945337, 10)
    expect(result).not.toBeNull()
    expect(result!.toString()).not.toMatch(/\.\d{10,}/)
  })
})

describe('fmtPercent', () => {
  it('formats positive percent', () => { expect(fmtPercent(12.345)).toBe('+12.35%') })
  it('formats negative percent', () => { expect(fmtPercent(-5.678)).toBe('-5.68%') })
  it('formats zero percent', () => { expect(fmtPercent(0)).toBe('+0.00%') })
  it('returns fallback for NaN', () => { expect(fmtPercent(NaN)).toBe('--') })
  it('returns fallback for null', () => { expect(fmtPercent(null)).toBe('--') })
  it('returns fallback for Infinity', () => { expect(fmtPercent(Infinity)).toBe('--') })
  it('supports sign=false option', () => { expect(fmtPercent(5, { sign: false })).toBe('5.00%') })
  it('supports custom fallback', () => { expect(fmtPercent(null, { fallback: '-' })).toBe('-') })
})

describe('fmtNumber', () => {
  it('formats with default decimals', () => { expect(fmtNumber(1.5945)).toBe('1.59') })
  it('formats with custom decimals', () => { expect(fmtNumber(1.5945, 4)).toBe('1.5945') })
  it('returns fallback for invalid', () => { expect(fmtNumber(null)).toBe('--') })
  it('rounds properly', () => { expect(fmtNumber(1.595, 2)).toBe('1.60') })
})

describe('fmtMoney', () => {
  it('formats money value', () => { expect(fmtMoney(1234.567)).toBe('1234.57') })
  it('returns fallback for invalid', () => { expect(fmtMoney(null)).toBe('--') })
})

describe('fmtAmountYi', () => {
  it('converts to 亿', () => { expect(fmtAmountYi(12345678900)).toBe('123.46亿') })
  it('returns fallback for invalid', () => { expect(fmtAmountYi(NaN)).toBe('--') })
})

describe('fmtChange', () => {
  it('formats positive change', () => { expect(fmtChange(5.67)).toBe('+5.67%') })
  it('formats negative change', () => { expect(fmtChange(-3.21)).toBe('-3.21%') })
  it('returns - for invalid', () => { expect(fmtChange(NaN)).toBe('-') })
  it('returns - for null', () => { expect(fmtChange(null)).toBe('-') })
})

describe('fmtRatio', () => {
  it('formats with 4 decimals by default', () => { expect(fmtRatio(1.5945337)).toBe('1.5945') })
  it('formats with custom decimals', () => { expect(fmtRatio(1.5945, 2)).toBe('1.59') })
  it('returns fallback for invalid', () => { expect(fmtRatio(null)).toBe('--') })
})

describe('fmtDrawdown', () => {
  it('formats drawdown with negative sign', () => { expect(fmtDrawdown(15.678)).toBe('-15.68%') })
  it('returns fallback for invalid', () => { expect(fmtDrawdown(null)).toBe('--') })
})

describe('returnClass', () => {
  it('returns positive for >0', () => { expect(returnClass(1)).toBe('positive') })
  it('returns negative for <0', () => { expect(returnClass(-1)).toBe('negative') })
  it('returns empty for 0', () => { expect(returnClass(0)).toBe('') })
  it('returns empty for invalid', () => { expect(returnClass(NaN)).toBe('') })
  it('returns empty for near-zero', () => { expect(returnClass(1e-13)).toBe('') })
})

describe('sharpeClass', () => {
  it('returns positive for >=1', () => { expect(sharpeClass(1.5)).toBe('positive') })
  it('returns empty for >=0.5', () => { expect(sharpeClass(0.8)).toBe('') })
  it('returns negative for <0.5', () => { expect(sharpeClass(0.3)).toBe('negative') })
  it('returns empty for invalid', () => { expect(sharpeClass(NaN)).toBe('') })
  it('handles zero correctly', () => { expect(sharpeClass(0)).toBe('negative') })
})

describe('scoreClass', () => {
  it('returns score-high for >=80', () => { expect(scoreClass(85)).toBe('score-high') })
  it('returns score-mid for >=60', () => { expect(scoreClass(72)).toBe('score-mid') })
  it('returns score-low for <60', () => { expect(scoreClass(45)).toBe('score-low') })
  it('returns empty for invalid', () => { expect(scoreClass(NaN)).toBe('') })
})
