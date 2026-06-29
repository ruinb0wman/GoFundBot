import { AppError } from '../../core/errors.js';
import type {
  ConstituentDto,
  ConstituentListDto,
  IndexDto,
  IndexListDto,
  KlineDto,
  KlineOptions,
  MarketProvider,
  MarketQuoteDto,
  SectorDto,
  SectorListDto,
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
    const url = 'https://push2.eastmoney.com/api/qt/clist/get';
    const params = new URLSearchParams({
      cb: '',
      fid: 'f3',
      po: '1',
      np: '1',
      fltt: '2',
      invt: '2',
      ut: 'bd1d9ddb04089700cf9c27f6f7426281',
      fs: 'm:90+t:2',
      fields: 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f9,f23,f62,f184',
      pn: '1',
      pz: '100',
    });

    const respData = await fetchJson(`${url}?${params.toString()}`);
    const dataNode = (respData.data ?? respData) as Record<string, unknown>;
    const diff = (dataNode.diff ?? []) as Record<string, unknown>[];
    const diffArr: Record<string, unknown>[] = Array.isArray(diff) ? diff : Object.values(diff);

    const items: SectorDto[] = diffArr
      .filter((bk) => {
        const code = String(bk.f12 ?? bk.code ?? '');
        return code.startsWith('BK');
      })
      .map((bk) => ({
        code: toString(bk.f12 ?? bk.code),
        name: toString(bk.f14 ?? bk.name),
        price: toNum(bk.f2),
        changePercent: toNum(bk.f3),
        mainNetInflow: toNum(bk.f62),
        turnoverRate: toNum(bk.f8),
      }));

    return { items };
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
      cb: '',
      fid: 'f3',
      po: '1',
      np: '1',
      fltt: '2',
      invt: '2',
      ut: 'bd1d9ddb04089700cf9c27f6f7426281',
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

function toNum(value: unknown): number | null {
  if (value == null || value === '' || value === '-') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
