/**
 * 海外标的的**单一真源**：全球指数与加密货币的代码表 / 名称 / 各家数据源代码。
 *
 * 为什么单独一个文件：腾讯、Yahoo、Binance 三家 provider 都要按同一份代码表取数，
 * 而 `marketService` 也要用它做符号分类。放在 `yahoo/yahooClient.ts` 里会让
 * 「腾讯的主源」反向依赖 Yahoo 的实现细节。
 *
 * 代码表变更会直接影响前端（`useMarketOverview` 的 chinaNames/globalNames 分组）
 * 与 pi 工具描述，改之前先看 `.pi/plans/global-market-sources.md` §4 Step 1。
 */

export interface GlobalIndexDef {
  code: string;
  name: string;
  /** 腾讯 `qt.gtimg.cn` / `newfqkline` 的代码；腾讯未收录的指数为 undefined */
  tencentSymbol?: string;
  /** 东财 `push2` 的 secid（`100.<code>`），腾讯未收录的日经/韩国/英德法/印度只有这一条路 */
  eastmoneySecid?: string;
  /** Yahoo 代码，末位兜底 */
  yahooSymbol: string;
}

export interface CryptoDef {
  code: string;
  name: string;
  /** Binance 现货代码（主源） */
  binanceSymbol: string;
  /** Yahoo 代码（保底，当前网络不可达） */
  yahooSymbol: string;
  icon: string;
}

export const GLOBAL_INDEX_DEFS: GlobalIndexDef[] = [
  { code: 'NDX', name: '纳斯达克100', tencentSymbol: 'usNDX', eastmoneySecid: '100.NDX', yahooSymbol: '^NDX' },
  { code: 'DJI', name: '道琼斯指数', tencentSymbol: 'usDJI', eastmoneySecid: '100.DJIA', yahooSymbol: '^DJI' },
  { code: 'SPX', name: '标普500', tencentSymbol: 'usINX', eastmoneySecid: '100.SPX', yahooSymbol: '^GSPC' },
  { code: 'HSI', name: '恒生指数', tencentSymbol: 'hkHSI', eastmoneySecid: '100.HSI', yahooSymbol: '^HSI' },
  { code: 'HSCEI', name: '国企指数', tencentSymbol: 'hkHSCEI', eastmoneySecid: '100.HSCEI', yahooSymbol: '^HSCE' },
  { code: 'N225', name: '日经225', eastmoneySecid: '100.N225', yahooSymbol: '^N225' },
  { code: 'KS11', name: '韩国综合指数', eastmoneySecid: '100.KS11', yahooSymbol: '^KS11' },
  { code: 'FTSE', name: '英国富时100', eastmoneySecid: '100.FTSE', yahooSymbol: '^FTSE' },
  { code: 'GDAXI', name: '德国DAX', eastmoneySecid: '100.GDAXI', yahooSymbol: '^GDAXI' },
  { code: 'FCHI', name: '法国CAC40', eastmoneySecid: '100.FCHI', yahooSymbol: '^FCHI' },
  { code: 'SENSEX', name: '印度SENSEX', eastmoneySecid: '100.SENSEX', yahooSymbol: '^BSESN' },
];

export const CRYPTO_DEFS: CryptoDef[] = [
  { code: 'BTC', name: '比特币', binanceSymbol: 'BTCUSDT', yahooSymbol: 'BTC-USD', icon: '₿' },
  { code: 'ETH', name: '以太坊', binanceSymbol: 'ETHUSDT', yahooSymbol: 'ETH-USD', icon: 'Ξ' },
  { code: 'SOL', name: 'Solana', binanceSymbol: 'SOLUSDT', yahooSymbol: 'SOL-USD', icon: '◎' },
  { code: 'BNB', name: '币安币', binanceSymbol: 'BNBUSDT', yahooSymbol: 'BNB-USD', icon: '◆' },
];

/** 历史遗留的 Yahoo 风格符号（`gb_ixic` 等），`toYahooSymbol()` 仍在用 */
export const LEGACY_GLOBAL_SYMBOL_MAP: Record<string, string> = {
  gb_ixic: '^IXIC',
  gb_dji: '^DJI',
  gb_inx: '^GSPC',
  hkhsi: '^HSI',
  hkhscei: '^HSCE',
  b_nky: '^N225',
  b_ks11: '^KS11',
  b_ukx: '^FTSE',
  b_dax: '^GDAXI',
  b_cac: '^FCHI',
  b_sensex: '^BSESN',
};

/** 对外代码（`dji`）→ Yahoo 符号（`^DJI`） */
export const CODE_TO_YAHOO_MAP: Record<string, string> = Object.fromEntries(
  GLOBAL_INDEX_DEFS.map((d) => [d.code.toLowerCase(), d.yahooSymbol]),
);

function normalizeKey(symbol: string): string {
  return symbol.replace(/^(sh|sz|bj)/i, '').toLowerCase();
}

export function findGlobalIndexDef(code: string): GlobalIndexDef | undefined {
  const upper = code.toUpperCase();
  return GLOBAL_INDEX_DEFS.find((d) => d.code === upper);
}

export function findCryptoDef(code: string): CryptoDef | undefined {
  const upper = code.toUpperCase();
  return CRYPTO_DEFS.find((d) => d.code === upper);
}

export function isGlobalIndexSymbol(symbol: string): boolean {
  const lower = normalizeKey(symbol);
  return lower in LEGACY_GLOBAL_SYMBOL_MAP || lower in CODE_TO_YAHOO_MAP;
}

export function isCryptoSymbol(symbol: string): boolean {
  return !!findCryptoDef(symbol);
}
