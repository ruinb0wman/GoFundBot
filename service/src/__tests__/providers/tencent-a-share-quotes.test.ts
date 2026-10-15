import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TencentMarketProvider } from '../../providers/tencent/tencentMarketProvider.js';

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));

vi.mock('../../core/fetch.js', () => ({ fetchUrl: fetchUrlMock }));

/**
 * A 股报价行字段回归（2026-10-15 实测原始行，GBK 解码后）。
 *
 * 背景：`[7]` 是**外盘**（指数行恒为 0），不是成交额；成交额在 `[35]` 的
 * `价/成交量/成交额` 三段式末段（单位元），退而求其次是 `[37]`（万元）。
 * 以前 `amount = parts[7]` 让指数详情页「成交额」恒为 0（显示 `--`），
 * 个股则显示成外盘手数（如贵州茅台 32619）。
 */
// prettier-ignore
const SSE_INDEX_ROW =
  '1~上证指数~000001~3707.48~3767.23~3710.70~510163189~0~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~~20261015161500~-59.75~-1.59~3724.56~3674.82~3707.48/510163189/774391973455~510163189~77439197~1.05~16.12~~3724.56~3674.82~1.32~580957.27~649692.63~0.00~-1~-1~1.06~0~3703.79~~~~~~77439197.3455~0.0000~0~ ~ZS~-6.59~-2.74~~~~4258.86~3674.82~-5.82~-6.18~-6.27~4861632418070~~-11.59~-10.42~4861632418070~~~-5.23~-0.09~~CNY~0~~0.00~0~';

// prettier-ignore
const KWEICHOW_ROW =
  '1~贵州茅台~600519~1312.97~1286.00~1286.00~57677~32619~25058~1312.31~3~1312.01~1~1312.00~5~1311.99~2~1311.90~2~1312.97~8~1312.99~3~1313.00~26~1313.01~15~1313.02~1~~20261015161456~26.97~2.10~1317.76~1282.00~1312.97/57677/7537706224~57677~753771~0.46~20.16~~1317.76~1282.00~2.78~16413.20~16413.20~6.53~1414.60~1157.40~2.03~-40~1306.88~18.43~19.94~~~0.07~753770.6224~275.7237~21~   A~GP-A~-2.68~4.55~3.96~32.41~27.30~1539.98~1151.01~4.93~1.71~4.95~1250081601~1250081601~-60.61~-5.06~1250081601~~~-6.88~-0.08~~CNY~0~___D__F__N~1311.81~16~';

function qtResponse(entries: Array<[string, string]>): string {
  return entries.map(([symbol, row]) => `v_${symbol}="${row}";`).join('\n');
}

describe('TencentMarketProvider.quotes — 成交量/成交额字段', () => {
  beforeEach(() => {
    fetchUrlMock.mockReset();
  });

  it('指数成交额取 [35] 三段式末段（元），不是恒为 0 的外盘 [7]', async () => {
    fetchUrlMock.mockResolvedValue(qtResponse([['sh000001', SSE_INDEX_ROW]]));

    const [quote] = await new TencentMarketProvider().quotes(['sh000001']);

    expect(quote.volume).toBe(510163189); // [6]，单位手
    expect(quote.amount).toBe(774391973455); // [35] 末段，单位元（7743.9 亿）
    expect(quote.amount).not.toBe(0);
  });

  it('个股成交额同样取 [35]，不再把外盘手数当成交额', async () => {
    fetchUrlMock.mockResolvedValue(qtResponse([['sh600519', KWEICHOW_ROW]]));

    const [quote] = await new TencentMarketProvider().quotes(['sh600519']);

    expect(quote.volume).toBe(57677);
    expect(quote.amount).toBe(7537706224);
    expect(quote.amount).not.toBe(32619); // [7] 外盘
  });

  it('[35] 不是三段式时退化到 [37] 万元 ×1e4', async () => {
    const parts = SSE_INDEX_ROW.split('~');
    parts[35] = '3707.48'; // 港股/美股的 [35] 只有现价，没有 `价/量/额`
    fetchUrlMock.mockResolvedValue(qtResponse([['sh000001', parts.join('~')]]));

    const [quote] = await new TencentMarketProvider().quotes(['sh000001']);

    expect(quote.amount).toBe(774391970000); // 77439197 万元
  });
});
