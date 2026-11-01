import { describe, it, expect } from 'vitest';
import { mergeGlobalIndexItems, normalizeIndexCodes } from '../../services/marketService.js';

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

describe('mergeGlobalIndexItems', () => {
  const quote = (code: string, provider: string) =>
    ({ code, name: code, price: 1, changePercent: null, changeAmount: null, market: '全球', volume: provider === 'tencent' ? 1 : null }) as never;

  it('keeps every def in GLOBAL_INDEX_DEFS order (tencent 5 + eastmoney 6)', () => {
    const tencent = [quote('NDX', 'tencent'), quote('DJI', 'tencent'), quote('SPX', 'tencent'), quote('HSI', 'tencent'), quote('HSCEI', 'tencent')];
    const eastmoney = ['NDX', 'DJI', 'SPX', 'HSI', 'HSCEI', 'N225', 'KS11', 'FTSE', 'GDAXI', 'FCHI', 'SENSEX'].map((c) => quote(c, 'eastmoney'));
    const merged = mergeGlobalIndexItems(tencent, eastmoney);

    expect(merged.map((i) => i.code)).toEqual(['NDX', 'DJI', 'SPX', 'HSI', 'HSCEI', 'N225', 'KS11', 'FTSE', 'GDAXI', 'FCHI', 'SENSEX']);
    // 前面的源优先：腾讯那 5 个带成交量，不能被东财的空 volume 覆盖
    expect(merged[0].volume).toBe(1);
    expect(merged[5].volume).toBeNull();
  });

  it('survives one source failing and drops unknown codes', () => {
    expect(mergeGlobalIndexItems([quote('N225', 'eastmoney'), quote('HSTECH', 'eastmoney')]).map((i) => i.code)).toEqual(['N225']);
    expect(mergeGlobalIndexItems()).toEqual([]);
  });
});
