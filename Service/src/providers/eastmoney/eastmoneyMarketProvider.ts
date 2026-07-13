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
      fields: 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18',
      secids: secids.join(','),
      _: String(Date.now()),
    });

    const respData = await fetchJson(`${url}?${params.toString()}`);
    const dataNode = (respData.data ?? respData) as Record<string, unknown>;
    const diff = (dataNode.diff ?? []) as Record<string, unknown>[];
    const diffArr: Record<string, unknown>[] = Array.isArray(diff) ? diff : Object.values(diff);

    const symbolToSecid = new Map<string, string>();
    for (let i = 0; i < symbols.length; i++) {
      symbolToSecid.set(secids[i], symbols[i]);
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
      };
    });
  }

  async kline(symbol: string, options: KlineOptions): Promise<KlineDto[]> {
    const m = symbol.match(/^(sh|sz|bj)(\d{5,6})$/i);
    if (!m) return [];
    const prefix = m[1].toLowerCase() === 'sh' ? '1.' : '0.';
    const secid = prefix + m[2];
    const cleanCode = m[2];

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

    if (options.startDate) params.set('beg', options.startDate.replaceAll('-', ''));
    if (options.endDate) params.set('end', options.endDate.replaceAll('-', ''));

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
      const change = toNum(parts[7]);
      const changePercent = toNum(parts[8]);
      const turnoverRate = toNum(parts[9]);

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
      // Step 1: get BK sector codes from clist/get (no cb param — plain JSON)
      const listUrl = 'https://push2.eastmoney.com/api/qt/clist/get';
      const listParams = new URLSearchParams({
        fid: 'f3',
        po: '1',
        np: '1',
        fltt: '2',
        invt: '2',
        fs: 'm:90+t:2',
        fields: 'f12,f14',
        pn: '1',
        pz: '500',
      });

      const listResp = await fetchJson(`${listUrl}?${listParams.toString()}`);
      const listData = (listResp.data ?? listResp) as Record<string, unknown>;
      const listDiff = (listData.diff ?? []) as Record<string, unknown>[];
      const listArr: Record<string, unknown>[] = Array.isArray(listDiff) ? listDiff : Object.values(listDiff);

      const bkCodes = listArr
        .map((item) => toString(item.f12 ?? ''))
        .filter((code) => code.startsWith('BK'));

      if (bkCodes.length === 0) return { items: [] };

      // Step 2: batch-query sector quotes via ulist.np/get (same reliable endpoint as indices())
      const secids = bkCodes.slice(0, 200).map((code) => `90.${code}`);
      const quoteUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
      const quoteParams = new URLSearchParams({
        fltt: '2',
        invt: '2',
        fields: 'f2,f3,f4,f12,f14,f62,f8',
        secids: secids.join(','),
        _: String(Date.now()),
      });

      const respData = await fetchJson(`${quoteUrl}?${quoteParams.toString()}`);
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
  // Market-wide money flow
  // -----------------------------------------------------------------------

  async marketMoneyFlow(): Promise<MarketMoneyFlowDto> {
    const symbol = '1.000001';
    const url = 'https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get';
    const params = new URLSearchParams({
      fields1: 'f1,f2,f3,f7',
      fields2: 'f51,f52,f53,f54,f55,f56,f57',
      lmt: '1',
      secid: symbol,
    });

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
  // Market breadth – up/down counts
  // Uses the SH index component count fields (f168=up, f169=down, f170=flat).
  // NOTE: Only covers Shanghai market. Shenzhen not available via push2.
  // limitUp/limitDown counts are not reliable from this endpoint.
  // -----------------------------------------------------------------------

  async breadth(): Promise<MarketBreadthDto> {
    const url = 'https://push2.eastmoney.com/api/qt/stock/get';
    const params = new URLSearchParams({
      secid: '1.000001',
      fields: 'f58,f168,f169,f170,f292,f293',
      ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    });

    try {
      const respData = await fetchJson(`${url}?${params.toString()}`, 10000);
      const data = (respData.data ?? respData) as Record<string, unknown>;

      const name = toString(data.f58 ?? '');
      const upCount = toInt(data.f168);
      const downCount = Math.abs(toInt(data.f169));
      const flatCount = Math.abs(toInt(data.f170));
      const limitUp = Math.abs(toInt(data.f292));
      const limitDown = Math.abs(toInt(data.f293));
      const total = upCount + downCount + flatCount;

      // Sanity check: A-share SH market has ~2000 stocks, total > 3000 is suspicious
      if (total > 0 && total < 3000 && (upCount > 0 || downCount > 0)) {
        return { upCount, downCount, flatCount, limitUp, limitDown, total };
      }
    } catch {
      // fallthrough
    }

    return { upCount: 0, downCount: 0, flatCount: 0, limitUp: 0, limitDown: 0, total: 0 };
  }

  // -----------------------------------------------------------------------
  // North-bound flow (港股通北向资金)
  // -----------------------------------------------------------------------

  async northFlow(): Promise<NorthFlowDto> {
    const url = 'https://push2.eastmoney.com/api/qt/kamt.kline/get';
    const params = new URLSearchParams({
      fields1: 'f1,f2,f3,f4',
      fields2: 'f51,f52,f53,f54',
      klt: '101',
      lmt: '1',
      secid: '1.000001',
    });

    const respData = await fetchJson(`${url}?${params.toString()}`, 15000);
    const data = (respData.data ?? respData) as Record<string, unknown>;

    const parseKamt = (key: string): { net: number | null; date: string } | null => {
      const arr = data[key] as string[] | undefined;
      if (Array.isArray(arr) && arr.length > 0) {
        const parts = arr[0].split(',');
        return { net: toMoneyFlowNum(parts[1]), date: String(parts[0] ?? '') };
      }
      return null;
    };

    const hk2sh = parseKamt('hk2sh');
    const hk2sz = parseKamt('hk2sz');
    const shNet = hk2sh?.net ?? null;
    const szNet = hk2sz?.net ?? null;
    const date = hk2sh?.date || hk2sz?.date || '';

    return {
      date,
      shNetInflow: shNet,
      szNetInflow: szNet,
      totalNetInflow: shNet != null || szNet != null ? (shNet ?? 0) + (szNet ?? 0) : null,
      shUpCount: null,
      shDownCount: null,
      szUpCount: null,
      szDownCount: null,
    };
  }

  // -----------------------------------------------------------------------
  // Global index spot prices
  // -----------------------------------------------------------------------

  async globalIndices(): Promise<GlobalIndexListDto> {
    const secids = [
      '100.NDX', '100.DJIA', '100.SPX',
      '100.HSI', '100.HSCEI', '100.HSTECH',
      '100.N225', '100.KS11',
      '100.FTSE', '100.GDAXI', '100.FCHI', '100.SENSEX',
    ];

    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
    const params = new URLSearchParams({
      fltt: '2',
      invt: '2',
      fields: 'f2,f3,f4,f12,f14,f15,f16,f17,f18,f371',
      secids: secids.join(','),
      _: String(Date.now()),
    });

    const respData = await fetchJson(`${url}?${params.toString()}`, 15000);
    const dataNode = (respData.data ?? respData) as Record<string, unknown>;
    const diff = (dataNode.diff ?? []) as Record<string, unknown>[];
    const diffArr: Record<string, unknown>[] = Array.isArray(diff) ? diff : Object.values(diff);

    const items: GlobalIndexDto[] = diffArr.map((item) => ({
      code: toString(item.f12 ?? ''),
      name: toString(item.f14 ?? ''),
      price: toNum(item.f2),
      changePercent: toNum(item.f3),
      changeAmount: toNum(item.f4),
      open: toNum(item.f15),
      high: toNum(item.f16),
      low: toNum(item.f17),
      prevClose: toNum(item.f18),
      market: 'global',
    }));

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

function toInt(value: unknown): number {
  const num = toNum(value);
  return num != null ? Math.floor(num) : 0;
}

function toMoneyFlowNum(value: unknown): number | null {
  if (value == null || value === '' || value === '-') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toEastMoneySecid(code: string): string {
  const normalized = code.replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '');
  if (/^6|^9/.test(normalized)) {
    return `1.${normalized}`;
  }
  return `0.${normalized}`;
}
