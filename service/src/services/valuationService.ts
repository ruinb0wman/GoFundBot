import { cache, ttl } from '../core/cache.js';
import { logger } from '../core/logger.js';
import { buildValuationBands } from '../../../packages/core/src/valuation.js';
import {
  fetchIndexPeHistory,
  toDanjuanCode,
  type ValuationPoint,
} from '../providers/danjuan/danjuanValuationClient.js';
import { normalizeIndexSymbol } from './marketService.js';
import type { ServiceResult } from '../types/common.js';
import type { IndexValuationDto } from '../types/valuation.js';

/**
 * 指数估值（PE 分位 + 机会/中位/危险值）。
 *
 * 设计与口径见 `.pi/plans/index-valuation-p1-plan.md`：
 * - 只用蛋卷一个源，不与乐咕/中证混用（等权 vs 加权差 1–2 倍，分位窗口也不同）；
 * - 任何失败都返回 200 + `data_status: 'unavailable'`，且**不进缓存**
 *   （同 `getMarketBreadth`：一次瞬时失败不该被钉住 6 小时）。
 */

const SOURCE = 'danjuan' as const;
const DEFINITION = '加权滚动PE(TTM) · 20/50/80 分位';

// shortcut: 只支持蛋卷收录的 A 股指数（未覆盖时显示「暂无」）；要扩覆盖必须再接源并重新定义窗口口径。

const keyOf = (code: string): string => `market:valuation:${code}`;

/** 数据源时间戳是北京 00:00；直接 `toISOString()` 会退一天（快讯那边踩过同一个 8 小时坑）。 */
function shanghaiDate(ts: number): string {
  return new Date(ts + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function unavailable(code: string, error: string): ServiceResult<IndexValuationDto> {
  return {
    data: {
      code,
      source_code: toDanjuanCode(code),
      name: null,
      as_of: '',
      data_status: 'unavailable',
      pe: null,
      percentile: null,
      bands: { opportunity: null, median: null, danger: null },
      source: SOURCE,
      definition: DEFINITION,
      window: null,
      error,
    },
    provider: SOURCE,
    fallback: false,
    cached: false,
    stale: false,
    updatedAt: new Date(),
  };
}

function buildDto(code: string, points: ValuationPoint[]): IndexValuationDto {
  const series = points.map((point) => point.pe);
  const last = points[points.length - 1];
  const bands = buildValuationBands(series, last.pe);

  return {
    code,
    source_code: toDanjuanCode(code),
    name: null,
    as_of: shanghaiDate(last.ts),
    data_status: 'available',
    pe: last.pe,
    percentile: bands.percentile,
    bands: {
      opportunity: bands.opportunity,
      median: bands.median,
      danger: bands.danger,
    },
    source: SOURCE,
    definition: DEFINITION,
    window: {
      start: shanghaiDate(points[0].ts),
      end: shanghaiDate(last.ts),
      points: points.length,
      freq: 'weekly',
    },
  };
}

export async function getIndexValuation(symbol: string): Promise<ServiceResult<IndexValuationDto>> {
  const code = normalizeIndexSymbol(symbol);
  // 海外/港股/加密/北交所：蛋卷没收录，直接说没有，不发请求。
  if (!toDanjuanCode(code)) return unavailable(code, '仅支持 A 股股票指数');

  const cached = cache.get<IndexValuationDto>(keyOf(code));
  if (cached) {
    return {
      data: cached.value,
      provider: SOURCE,
      fallback: false,
      cached: true,
      stale: false,
      updatedAt: cached.updatedAt,
    };
  }

  try {
    const points = await fetchIndexPeHistory(code);
    if (points.length === 0) return unavailable(code, '数据源未收录该指数');

    const dto = buildDto(code, points);
    cache.set(keyOf(code), dto, ttl.marketValuation);
    return {
      data: dto,
      provider: SOURCE,
      fallback: false,
      cached: false,
      stale: false,
      updatedAt: new Date(),
    };
  } catch (err) {
    logger.warn('index valuation unavailable', {
      code,
      error: err instanceof Error ? err.message : String(err),
    });
    return unavailable(code, '估值数据源暂不可用');
  }
}
