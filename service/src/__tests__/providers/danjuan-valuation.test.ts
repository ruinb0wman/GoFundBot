import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchIndexPeHistory,
  toDanjuanCode,
} from '../../providers/danjuan/danjuanValuationClient.js';

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));

vi.mock('../../core/fetch.js', () => ({ fetchUrl: fetchUrlMock }));

/**
 * 蛋卷估值取数（唯一源）。
 *
 * 口径与覆盖见 `.pi/plans/index-valuation-feasibility.md`：它只收录 63 个指数，
 * 未收录（上证综指 / 中证A500 / 科创100）必须返回 `[]` 而不是抛错。
 */

const payload = (rows: unknown) => ({ data: { index_eva_pe_growths: rows } });

describe('toDanjuanCode', () => {
  it('maps A-share codes by upper-casing the prefix', () => {
    expect(toDanjuanCode('sh000300')).toBe('SH000300');
    expect(toDanjuanCode('SZ399006')).toBe('SZ399006');
    expect(toDanjuanCode('sz399001')).toBe('SZ399001');
  });

  it('rejects anything that is not a sh/sz index', () => {
    // 海外/加密/北交所都没有估值数据（蛋卷只收录 A 股 + 少量海外）。
    expect(toDanjuanCode('DJI')).toBeNull();
    expect(toDanjuanCode('BTC')).toBeNull();
    expect(toDanjuanCode('bj430047')).toBeNull();
    expect(toDanjuanCode('sh00030')).toBeNull();
  });
});

describe('fetchIndexPeHistory', () => {
  beforeEach(() => {
    fetchUrlMock.mockReset();
  });

  it('parses rows and sorts them by timestamp', async () => {
    fetchUrlMock.mockResolvedValue(payload([
      { ts: 300, pe: 13 },
      { ts: 100, pe: 11 },
      { ts: 200, pe: 12 },
    ]));

    const points = await fetchIndexPeHistory('sh000300');

    expect(points).toEqual([
      { ts: 100, pe: 11 },
      { ts: 200, pe: 12 },
      { ts: 300, pe: 13 },
    ]);
    expect(fetchUrlMock.mock.calls[0][0]).toContain('/pe_history/SH000300?day=all');
  });

  it('drops rows with a non-numeric pe / ts', async () => {
    fetchUrlMock.mockResolvedValue(payload([
      { ts: 100, pe: 11 },
      { ts: 200, pe: null },
      { pe: 12 },
      'oops',
    ]));

    expect(await fetchIndexPeHistory('sh000300')).toEqual([{ ts: 100, pe: 11 }]);
  });

  it('returns [] for an index the source does not cover (no data key)', async () => {
    fetchUrlMock.mockResolvedValue({ result_code: 0 });
    expect(await fetchIndexPeHistory('sh000001')).toEqual([]);
  });

  it('returns [] without any request for unsupported codes', async () => {
    expect(await fetchIndexPeHistory('BTC')).toEqual([]);
    expect(fetchUrlMock).not.toHaveBeenCalled();
  });

  it('falls back to the proxy once before giving up', async () => {
    fetchUrlMock
      .mockRejectedValueOnce(new Error('direct blocked'))
      .mockResolvedValueOnce(payload([{ ts: 100, pe: 11 }]));

    expect(await fetchIndexPeHistory('sh000300')).toEqual([{ ts: 100, pe: 11 }]);
    expect(fetchUrlMock).toHaveBeenCalledTimes(2);
    expect(fetchUrlMock.mock.calls[1][1]).toMatchObject({ proxy: 'auto' });
  });

  it('throws when both direct and proxied attempts fail', async () => {
    fetchUrlMock
      .mockRejectedValueOnce(new Error('direct blocked'))
      .mockRejectedValueOnce(new Error('proxy blocked'));

    await expect(fetchIndexPeHistory('sh000300')).rejects.toThrow('direct blocked');
  });
});
