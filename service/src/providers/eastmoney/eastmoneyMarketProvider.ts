import { AppError } from '../../core/errors.js';
import type {
  ConstituentDto,
  ConstituentListDto,
  GlobalIndexDto,
  GlobalIndexListDto,
  IndexDto,
  IndexListDto,
  KlineDto,
  KlineOptions,
  MarketBreadthDto,
  MarketMoneyFlowDto,
  MarketProvider,
  MarketQuoteDto,
  NorthFlowDto,
  SectorDto,
  SectorListDto,
  StockMoneyFlowDto,
  StockMoneyFlowPointDto,
} from '../types.js';
import { fetchJson, fetchText } from './eastmoneyRequest.js';
import { fetchMarketBreadth } from './marketBreadth.js';
import { fetchMarketNorthFlow } from './marketNorthFlow.js';
import { GLOBAL_INDEX_DEFS, findGlobalIndexDef } from '../globalIndexDefs.js';

const DEFAULT_REFERER = 'https://quote.eastmoney.com/';

export class EastMoneyMarketProvider implements MarketProvider {
  readonly name = 'eastmoney';

  async quotes(symbols: string[]): Promise<MarketQuoteDto[]> {
    const secids = symbols
      .map((sym) => {
        const m = sym.match(/^(sh|sz|bj)(\d{5,6})$/i);
        if (!m) return null;
        const prefix = m[1].toLowerCase() === 'sh' ? '1.' : '0.';
        return prefix + m[2];
      })
      .filter((id): id is string => id !== null);

    if (secids.length === 0) return [];

    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
    const params = new URLSearchParams({
      fltt: '2',
      invt: '2',
      fields: 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f124',
      secids: secids.join(','),
      _: String(Date.now()),
    });

    const respData = await fetchJson(`${url}?${params.toString()}`);
    const dataNode = (respData.data ?? respData) as Record<string, unknown>;
    const diff = (dataNode.diff ?? []) as Record<string, unknown>[];
    const diffArr: Record<string, unknown>[] = Array.isArray(diff) ? diff : Object.values(diff);

    const symbolToSecid = new Map<string, string>();
    for (let i = 0; i < symbols.length; i++) {
      symbolToSecid.set(secids[i].split('.')[1], symbols[i]);
    }

    return diffArr.map((item) => {
      const secid = toString(item.f12 ?? '');
      const originalSymbol = symbolToSecid.get(secid) || secid;
      return {
        symbol: originalSymbol,
        code: originalSymbol.replace(/^(sh|sz|bj)/, ''),
        name: toString(item.f14 ?? item.name),
        price: toNum(item.f2) ?? 0,
        change: toNum(item.f4) ?? 0,
        changePercent: toNum(item.f3) ?? 0,
        volume: toNum(item.f5) ?? 0,
        amount: toNum(item.f6) ?? 0,
        market: originalSymbol.startsWith('sh') ? '上海' : '深圳',
        assetType: 'index',
        source: 'eastmoney.quotes',
        date: toQuoteDate(item.f124),
      };
    });
  }

  async kline(symbol: string, options: KlineOptions): Promise<KlineDto[]> {
    // 海外指数（日经/韩国/英德法/印度）走东财 `100.<code>` 口径：腾讯未收录，Yahoo 在本机不可达。
    const globalDef = findGlobalIndexDef(symbol);
    const m = symbol.match(/^(sh|sz|bj)(\d{5,6})$/i);
    const secid = globalDef?.eastmoneySecid
      ?? (m ? (m[1].toLowerCase() === 'sh' ? '1.' : '0.') + m[2] : null);
    if (!secid) return [];
    const cleanCode = globalDef?.code ?? m![2];

    const kltMap: Record<string, string> = { daily: '101', weekly: '102', monthly: '103' };
    const klt = kltMap[options.period] || '101';

    const fqtMap: Record<string, string> = { qfq: '1', hfq: '2', '': '0', none: '0' };
    const fqt = fqtMap[options.adjust] || '0';

    const params = new URLSearchParams({
      secid,
      klt,
      fqt,
      fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      _: String(Date.now()),
    });

    // 东财 kline **必须**带 beg/end，否则直接回 `rc:102`（data:null）；历史全量用 beg=0。
    params.set('beg', options.startDate ? options.startDate.replaceAll('-', '') : '0');
    params.set('end', options.endDate ? options.endDate.replaceAll('-', '') : '20500101');

    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
    const respData = await fetchJson(`${url}?${params.toString()}`);
    const dataNode = (respData.data ?? respData) as Record<string, unknown>;
    const klines = dataNode.klines as string[] | undefined;
    if (!Array.isArray(klines)) return [];

    return klines.map((line: string) => {
      const parts = line.split(',');
      const date = parts[0] || '';
      const timestamp = date ? new Date(date).getTime() : null;
      const open = toNum(parts[1]);
      const close = toNum(parts[2]);
      const high = toNum(parts[3]);
      const low = toNum(parts[4]);
      const volume = toNum(parts[5]);
      const amount = toNum(parts[6]);
      // fields2 = f51..f61 → [date, open, close, high, low, volume, amount, 振幅, 涨跌幅, 涨跌额, 换手率]
      // （以前错位成 [7]=涨跌额 / [8]=涨跌幅 / [9]=换手率，把振幅当成了涨跌额）
      const changePercent = toNum(parts[8]);
      const change = toNum(parts[9]);
      const turnoverRate = toNum(parts[10]);

      return {
        code: cleanCode,
        date,
        timestamp,
        open,
        close,
        high,
        low,
        volume,
        amount,
        change,
        changePercent,
        turnoverRate,
      };
    });
  }

  async sectors(): Promise<SectorListDto> {
    try {
      const url = 'https://push2.eastmoney.com/api/qt/clist/get';
      const params = new URLSearchParams({
        pn: '1',
        pz: '100',
        po: '1',
        np: '1',
        fltt: '2',
        invt: '2',
        fid: 'f3',
        fs: 'm:90+t:2',
        fields: 'f2,f3,f4,f8,f12,f14,f62,f124',
        _: String(Date.now()),
      });

      const respData = await fetchJson(`${url}?${params.toString()}`);
      const dataNode = (respData.data ?? respData) as Record<string, unknown>;
      const diff = (dataNode.diff ?? []) as Record<string, unknown>[];
      const diffArr: Record<string, unknown>[] = Array.isArray(diff) ? diff : Object.values(diff);

      const items: SectorDto[] = diffArr.map((bk) => ({
        code: toString(bk.f12 ?? bk.code),
        name: toString(bk.f14 ?? bk.name),
        price: toNum(bk.f2),
        changePercent: toNum(bk.f3),
        mainNetInflow: toNum(bk.f62),
        turnoverRate: toNum(bk.f8),
        date: toQuoteDate(bk.f124),
      }));

      return { items };
    } catch (err) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `EastMoney sectors failed: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }
  }

  async sectorConstituents(code: string): Promise<ConstituentListDto> {
    // Fetch sector detail (name) and constituents
    const [detailData, clistData] = await Promise.allSettled([
      this.fetchSectorDetail(code),
      this.fetchSectorConstituentsRaw(code),
    ]);

    const sectorName =
      detailData.status === 'fulfilled' ? detailData.value : null;

    const items: ConstituentDto[] =
      clistData.status === 'fulfilled'
        ? clistData.value.map((item: Record<string, unknown>) => ({
            code: toString(item.f12 ?? item.code),
            name: toString(item.f14 ?? item.name),
            price: toNum(item.f2),
            changePercent: toNum(item.f3),
            marketValue: toNum(item.f20),
            pe: toNum(item.f9),
            turnoverRate: toNum(item.f8),
          }))
        : [];

    if (items.length === 0 && clistData.status === 'rejected') {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Failed to fetch sector constituents: ${(clistData.reason as Error)?.message ?? 'unknown error'}`,
        502
      );
    }

    return { items, sectorCode: code, sectorName };
  }

  async indices(): Promise<IndexListDto> {
    const indices = [
      { code: '1.000001', name: '上证指数', market: 'A股' },
      { code: '0.399001', name: '深证成指', market: 'A股' },
      { code: '0.399006', name: '创业板指', market: 'A股' },
      { code: '1.000300', name: '沪深300', market: 'A股' },
      { code: '1.000688', name: '科创50', market: 'A股' },
    ];

    const secids = indices.map((idx) => idx.code).join(',');
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
    const params = new URLSearchParams({
      fltt: '2',
      invt: '2',
      fields: 'f2,f3,f4,f12,f14',
      secids,
      _: String(Date.now()),
    });

    try {
      const respData = await fetchJson(`${url}?${params.toString()}`);
      const dataNode = (respData.data ?? respData) as Record<string, unknown>;
      const diff = (dataNode.diff ?? []) as Record<string, unknown>[];
      const diffArr: Record<string, unknown>[] = Array.isArray(diff) ? diff : Object.values(diff);
      const idxMap = new Map(indices.map((i) => [i.code.split('.')[1], i]));

      const items: IndexDto[] = diffArr
        .filter((item) => idxMap.has(String(item.f12 ?? '')))
        .map((item) => {
          const code = String(item.f12 ?? '');
          const idxInfo = idxMap.get(code);
          return {
            code,
            name: idxInfo?.name ?? String(item.f14 ?? ''),
            price: toNum(item.f2),
            changePercent: toNum(item.f3),
            changeAmount: toNum(item.f4),
            market: idxInfo?.market ?? 'A股',
          };
        });

      // Fill in any missing indices
      const returnedNames = new Set(items.map((i) => i.name));
      for (const idx of indices) {
        if (!returnedNames.has(idx.name)) {
          items.push({
            code: idx.code,
            name: idx.name,
            price: null,
            changePercent: null,
            changeAmount: null,
            market: idx.market,
          });
        }
      }

      return { items };
    } catch {
      // Return placeholder data on failure
      return {
        items: indices.map((idx) => ({
          code: idx.code,
          name: idx.name,
          price: null,
          changePercent: null,
          changeAmount: null,
          market: idx.market,
        })),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Money Flow – per stock
  // -----------------------------------------------------------------------

  async moneyFlow(code: string, days = 1): Promise<StockMoneyFlowDto> {
    const secid = toEastMoneySecid(code);
    const url = 'https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get';
    const params = new URLSearchParams({
      fields1: 'f1,f2,f3,f7',
      fields2: 'f51,f52,f53,f54,f55,f56,f57',
      lmt: String(days),
      secid,
    });

    const respData = await fetchJson(`${url}?${params.toString()}`, 15000);
    const data = (respData.data ?? respData) as Record<string, unknown>;
    const rawKlines = (data.klines ?? []) as string[];

    const items: StockMoneyFlowPointDto[] = (Array.isArray(rawKlines) ? rawKlines : []).map((line) => {
      const parts = line.split(',');
      return {
        date: String(parts[0] ?? ''),
        mainNetInflow: toMoneyFlowNum(parts[1]),
        superLargeNetInflow: toMoneyFlowNum(parts[5]),
        largeNetInflow: toMoneyFlowNum(parts[4]),
        mediumNetInflow: toMoneyFlowNum(parts[3]),
        smallNetInflow: toMoneyFlowNum(parts[2]),
        mainNetInflowRatio: toNum(parts[6]),
      };
    });

    return {
      code: toString(data.code ?? code),
      name: toNullableString(data.name),
      items,
    };
  }

  // -----------------------------------------------------------------------
  // Market-wide money flow (沪深两市合计)
  // -----------------------------------------------------------------------

  async marketMoneyFlow(): Promise<MarketMoneyFlowDto> {
    const url = 'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get';
    const params = new URLSearchParams({
      fields1: 'f1,f2,f3,f7',
      fields2: 'f51,f52,f53,f54,f55,f56,f57',
      lmt: '1',
      klt: '101',
      secid: '1.000001',
      secid2: '0.399001',
      ut: 'b2884a393a59ad64002292a3e90d46a5',
      _: String(Date.now()),
    });

    try {
      const respData = await fetchJson(`${url}?${params.toString()}`, 15000);
      const data = (respData.data ?? respData) as Record<string, unknown>;
      const rawKlines = (data.klines ?? []) as string[];

      if (Array.isArray(rawKlines) && rawKlines.length > 0) {
        const parts = rawKlines[0].split(',');
        return {
          date: String(parts[0] ?? ''),
          mainNetInflow: toMoneyFlowNum(parts[1]),
          superLargeNetInflow: toMoneyFlowNum(parts[5]),
          largeNetInflow: toMoneyFlowNum(parts[4]),
          mediumNetInflow: toMoneyFlowNum(parts[3]),
          smallNetInflow: toMoneyFlowNum(parts[2]),
        };
      }
    } catch {
      // fall through to default
    }

    return {
      date: '',
      mainNetInflow: null,
      superLargeNetInflow: null,
      largeNetInflow: null,
      mediumNetInflow: null,
      smallNetInflow: null,
    };
  }

  // -----------------------------------------------------------------------
  // Market breadth – 沪深两市涨跌家数 + 涨跌停家数
  // 实现见 marketBreadth.ts（字段口径与踩坑说明都写在那里）
  // -----------------------------------------------------------------------

  async breadth(): Promise<MarketBreadthDto> {
    return fetchMarketBreadth();
  }

  // -----------------------------------------------------------------------
  // North-bound flow (北向资金)
  // 实现见 marketNorthFlow.ts（净流入已停止披露，改报当日成交总额）
  // -----------------------------------------------------------------------

  async northFlow(): Promise<NorthFlowDto> {
    return fetchMarketNorthFlow();
  }

  // -----------------------------------------------------------------------
  // Global index spot prices
  // -----------------------------------------------------------------------

  async globalIndices(): Promise<GlobalIndexListDto> {
    // 腾讯只覆盖 5 个（NDX/DJI/SPX/HSI/HSCEI），日经/韩国/英德法/印度只有东财 `100.<code>` 这个口径。
    // 用批量端点 `ulist.np`（一次 11 个）而不是逐个 `stock/get`：请求量少一个数量级，
    // 而 push2 是路径级限流的（见 AGENTS「push2 现状」）。
    const defs = GLOBAL_INDEX_DEFS.filter((def) => def.eastmoneySecid);
    const bySecid = new Map(defs.map((def) => [def.eastmoneySecid as string, def]));

    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
    const params = new URLSearchParams({
      fltt: '2',
      invt: '2',
      fields: 'f2,f3,f4,f12,f13,f14,f15,f16,f17,f18,f124',
      secids: defs.map((def) => def.eastmoneySecid).join(','),
      _: String(Date.now()),
    });

    const respData = await fetchJson(`${url}?${params.toString()}`, 15000);
    const dataNode = (respData.data ?? respData) as Record<string, unknown>;
    const diff = (dataNode.diff ?? []) as Record<string, unknown>[];
    const diffArr: Record<string, unknown>[] = Array.isArray(diff) ? diff : Object.values(diff);

    const items: GlobalIndexDto[] = diffArr.flatMap((item) => {
      const def = bySecid.get(`${toString(item.f13 ?? 100)}.${toString(item.f12 ?? '')}`);
      // 海外指数不给成交额（东财 f6 也没有）：美股指数的成交量×点位是合成值，见 `parseTencentGlobalQuotes`。
      if (!def) return [];
      return [{
        code: def.code,
        name: def.name,
        price: toNum(item.f2),
        changePercent: toNum(item.f3),
        changeAmount: toNum(item.f4),
        open: toNum(item.f17),
        high: toNum(item.f15),
        low: toNum(item.f16),
        prevClose: toNum(item.f18),
        // 恒生系归「港股」，否则前端会同时命中 chinaNames 与 globalNames 而两栏重复。
        market: def.code.startsWith('HS') ? '港股' : '全球',
        date: toQuoteDate(item.f124),
      }];
    });

    return { items };
  }

  private async fetchSectorDetail(code: string): Promise<string | null> {
    const url = 'https://91.push2.eastmoney.com/api/qt/stock/get';
    const params = new URLSearchParams({
      ut: 'bd1d9ddb04089700cf9c27f6f7426281',
      fltt: '2',
      invt: '2',
      fields: 'f57,f58',
      secid: `90.${code}`,
    });

    const respData = await fetchJson(`${url}?${params.toString()}`);
    const dataNode = (respData.data ?? respData) as Record<string, unknown>;
    return toString(dataNode.f57 ?? dataNode.f58 ?? null);
  }

  private async fetchSectorConstituentsRaw(code: string): Promise<Record<string, unknown>[]> {
    const url = 'https://push2.eastmoney.com/api/qt/clist/get';
    const params = new URLSearchParams({
      fid: 'f3',
      po: '1',
      np: '1',
      fltt: '2',
      invt: '2',
      fs: `b:${code}`,
      fields: 'f12,f14,f2,f3,f8,f9,f20',
      pn: '1',
      pz: '200',
    });

    const respData = await fetchJson(`${url}?${params.toString()}`);
    const dataNode = (respData.data ?? respData) as Record<string, unknown>;
    const diff = (dataNode.diff ?? []) as Record<string, unknown>[];
    return Array.isArray(diff) ? diff : Object.values(diff);
  }
}

function toString(value: unknown): string {
  return value == null || value === '' ? '' : String(value);
}

function toNullableString(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

function toNum(value: unknown): number | null {
  if (value == null || value === '' || value === '-') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toMoneyFlowNum(value: unknown): number | null {
  if (value == null || value === '' || value === '-') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toQuoteDate(value: unknown): string {
  const ts = toNum(value);
  if (!ts) return '';
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function toEastMoneySecid(code: string): string {
  const normalized = code.replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '');
  if (/^6|^9/.test(normalized)) {
    return `1.${normalized}`;
  }
  return `0.${normalized}`;
}
