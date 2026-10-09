import { describe, expect, it } from 'vitest'
import { toReturnNavPoints } from '@gofund/core/backtest/navSeries'

/**
 * 回测取数口径：累计净值优先（份额拆分/分红不产生假跳水）。
 * 真实数据参考：512010 在 2021-06-24 由 3.206 → 0.8207（1:4 拆分），
 * 512480 在 2021-03-25 与 2026-07-01 各 1:2，159928 在 2021-06-23 1:4。
 */
describe('toReturnNavPoints', () => {
  it('有累计净值时用它，拆分当天的单位净值假跳水被丢掉', () => {
    const points = toReturnNavPoints([
      { date: '2021-06-23', nav: 3.5, accNav: 3.5 },
      { date: '2021-06-24', nav: 0.82, accNav: 3.4 },
      { date: '2021-06-25', nav: 0.84, accNav: 3.48 },
    ])
    expect(points).toEqual([
      { date: '2021-06-23', nav: 3.5 },
      { date: '2021-06-24', nav: 3.4 },
      { date: '2021-06-25', nav: 3.48 },
    ])
  })

  it('累计净值整体缺失（货币基金/低质量源）时退回单位净值', () => {
    const points = toReturnNavPoints([
      { date: '2026-01-05', nav: 1.234, accNav: null },
      { date: '2026-01-06', nav: 1.235, accNav: null },
    ])
    expect(points.map((p) => p.nav)).toEqual([1.234, 1.235])
  })

  it('累计净值只有零星几个点有值时整条序列仍用单位净值（阈值 95%）', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      nav: 1 + i / 100,
      accNav: null as number | null,
    }))
    items[7].accNav = 9.99
    const points = toReturnNavPoints(items)
    expect(points[7].nav).toBeCloseTo(1.07, 6)
  })

  it('丢弃无日期/非正净值/非数组输入', () => {
    expect(toReturnNavPoints(undefined)).toEqual([])
    expect(toReturnNavPoints('nope')).toEqual([])
    expect(
      toReturnNavPoints([
        { date: '2026-01-05', nav: 0, accNav: 0 },
        { nav: 1.2, accNav: 1.2 },
        { date: '2026-01-07', nav: '1.25', accNav: null },
      ]),
    ).toEqual([{ date: '2026-01-07', nav: 1.25 }])
  })
})
