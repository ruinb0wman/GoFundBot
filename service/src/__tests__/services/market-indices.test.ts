import { describe, it, expect } from 'vitest';
import { normalizeIndexCodes } from '../../services/marketService.js';

describe('normalizeIndexCodes', () => {
  const item = (code: string, name: string, price: number | null = null) => ({
    code,
    name,
    price,
    changePercent: null,
    changeAmount: null,
    market: 'A股',
  });

  it('maps numeric codes (EastMoney fallback style) to canonical prefixed codes', () => {
    const normalized = normalizeIndexCodes({
      items: [
        item('000001', '上证指数', 3387.32),
        item('399001', '深证成指', 10543.2),
        item('399006', '创业板指', 2178.9),
        item('000300', '沪深300', 3930.4),
        item('000688', '科创50', 1012.7),
      ],
    });

    expect(normalized.items.map((i) => i.code)).toEqual([
      'sh000001',
      'sz399001',
      'sz399006',
      'sh000300',
      'sh000688',
    ]);
    expect(normalized.items[0].price).toBe(3387.32);
  });

  it('keeps already-prefixed codes (stock-sdk style) unchanged', () => {
    const normalized = normalizeIndexCodes({
      items: [item('sh000001', '上证指数', 3387.32), item('sh000688', '科创50', 1012.7)],
    });

    expect(normalized.items.map((i) => i.code)).toEqual(['sh000001', 'sh000688']);
  });

  it('passes through unknown items unchanged', () => {
    const unknown = { items: [item('XX999999', '未知指数')] };

    expect(normalizeIndexCodes(unknown)).toEqual(unknown);
  });
});
