import { describe, expect, it } from 'vitest'
import { mergeNavPoints } from '../../db/navCache'

describe('mergeNavPoints', () => {
  it('unions by date, sorts ascending and lets the newer fetch win', () => {
    const base = [
      { date: '2020-01-02', nav: 2 },
      { date: '2020-01-03', nav: 3 },
    ]
    const incoming = [
      { date: '2020-01-03', nav: 3.5 },
      { date: '2020-01-06', nav: 4 },
    ]
    expect(mergeNavPoints(base, incoming)).toEqual([
      { date: '2020-01-02', nav: 2 },
      { date: '2020-01-03', nav: 3.5 },
      { date: '2020-01-06', nav: 4 },
    ])
  })

  it('handles empty inputs', () => {
    expect(mergeNavPoints([], [])).toEqual([])
    expect(mergeNavPoints([{ date: '2020-01-02', nav: 2 }], [])).toEqual([{ date: '2020-01-02', nav: 2 }])
  })
})
