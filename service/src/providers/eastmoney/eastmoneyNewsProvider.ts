import { createHash } from 'node:crypto';
import type { NewsItemDto, NewsListDto, NewsProvider } from '../types.js';
import { fetchJson, fetchText } from './eastmoneyRequest.js';

export class EastMoneyNewsProvider implements NewsProvider {
  readonly name = 'eastmoney';

  async flashNews(count = 30): Promise<NewsListDto> {
    try {
      const url = `https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_${count}_1_.html`;
      const text = await fetchText(url);
      const match = text.match(/ajaxResult\s*=\s*(\{.*\})\s*;?\s*$/s);
      const payload = match ? (JSON.parse(match[1]) as Record<string, unknown>) : (JSON.parse(text) as Record<string, unknown>);

      const newsList = (payload.LivesList ?? payload.data ?? payload.list ?? []) as Record<string, unknown>[];

      const items: NewsItemDto[] = (Array.isArray(newsList) ? newsList : [])
        .map((item) => ({
          title: toString(item.title ?? item.digest ?? item.simtitle),
          summary: toNullableString(item.digest ?? item.summary),
          url: toNullableString(item.url),
          source: '东方财富',
          publishedAt: formatNewsTime(item.showtime ?? item.time ?? item.ctime),
        }))
        .filter((item) => item.title);

      return { items };
    } catch {
      return { items: [] };
    }
  }
}

export class BaiduNewsProvider implements NewsProvider {
  readonly name = 'baidu';

  async flashNews(count = 30): Promise<NewsListDto> {
    try {
      const params = new URLSearchParams({
        rn: String(count),
        pn: '0',
        tag: 'A股',
        finClientType: 'pc',
      });
      const payload = await fetchJson(`https://finance.pae.baidu.com/selfselect/expressnews?${params.toString()}`);

      if (payload.ResultCode !== '0') {
        return { items: [] };
      }

      const newsList = getNested(payload, ['Result', 'content', 'list'], []) as Record<string, unknown>[];

      const items: NewsItemDto[] = (Array.isArray(newsList) ? newsList : [])
        .map((item) => {
          let title = toString(item.title ?? '');
          if (!title && (item.content as Record<string, unknown>)?.items) {
            const contentItems = (item.content as Record<string, unknown>).items as Record<string, unknown>[];
            if (contentItems && contentItems.length > 0) {
              title = toString(contentItems[0].data ?? '');
            }
          }
          return {
            title,
            summary: toNullableString(item.evaluate),
            url: toNullableString(item.url),
            source: '百度股市通',
            publishedAt: formatNewsTime(item.publish_time),
          };
        })
        .filter((item) => item.title);

      return { items };
    } catch {
      return { items: [] };
    }
  }
}

/** 财联社 `rn` 的硬上限：实测 50 可用、51 静默回空。 */
export const CLS_MAX_RN = 50;

export class ClsNewsProvider implements NewsProvider {
  readonly name = 'cls';

  async flashNews(count = 30): Promise<NewsListDto> {    try {
      const url = `https://www.cls.cn/v1/roll/get_roll_list?${buildClsSignedQuery(count)}`;
      const payload = await fetchJson(url);
      const data = (payload.data ?? {}) as Record<string, unknown>;
      const newsList = (data.roll_data ?? data.telegram ?? data.list ?? []) as Record<string, unknown>[];

      const items: NewsItemDto[] = (Array.isArray(newsList) ? newsList : [])
        .map((item) => {
          // `title` 经常是空串，正文在 `brief` / `content`（同一段文字），所以往后排。
          const title = toString(item.title) || toString(item.brief) || toString(item.content);
          const summary =
            [item.brief, item.content]
              .map(toString)
              .find((text) => text && text !== title) ?? null;
          return {
            title,
            summary,
            url: toNullableString(item.shareurl ?? item.url),
            source: '财联社',
            publishedAt: formatNewsTime(item.ctime ?? item.time ?? item.created_at),
          };
        })
        .filter((item) => item.title);

      return { items };
    } catch {
      return { items: [] };
    }
  }
}

/**
 * 财联社 `v1/roll/get_roll_list` 的签名 query（**不带** 前导 `?`）。
 *
 * 2026-10-14：旧端点 `nodeapi/telegraphList` 已 404（返回 Next.js 的 404 页），
 * 于是这个 provider 自 2026-10-10 起每小时踢 20-60 次熔断日志（快讯靠东财/百度顶着）。
 * 新端点要 `sign`，算法与参数顺序**照抄 akshare `stock_info_global_cls`**：
 * `md5(sha1(urlencode(params)))`，且 `last_time` 是当前秒级时间戳。
 * 参数顺序会进 hash，所以不能换顺序；`nowMs` 只为可测性暴露。
 *
 * `rn` 上限 **50**：实测 50 还能拿到 50 条，**51 就直接回 0 条**（不报错，静默空）。
 * 而调用方传的是 `count * 2`（分页/去重留余量），所以 count ≥ 26 时原本会全部丢掉。
 */
export function buildClsSignedQuery(count: number, nowMs: number = Date.now()): string {
  const params = new URLSearchParams();
  params.set('app', 'CailianpressWeb');
  params.set('category', '');
  params.set('last_time', String(Math.floor(nowMs / 1000)));
  params.set('os', 'web');
  params.set('refresh_type', '1');
  params.set('rn', String(Math.min(Math.max(Math.trunc(count), 1), CLS_MAX_RN)));
  params.set('sv', '8.4.6');

  const query = params.toString();
  const sign = createHash('md5')
    .update(createHash('sha1').update(query).digest('hex'))
    .digest('hex');
  return `${query}&sign=${sign}`;
}

function toString(value: unknown): string {
  return value == null ? '' : String(value);
}

function toNullableString(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

function formatNewsTime(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    let ts = Number(value);
    if (!Number.isFinite(ts)) return null;
    if (ts > 10_000_000_000) ts = Math.floor(ts / 1000);
    // 数字时间戳按**东八区**输出：其余 provider 给的是本地时间字符串，
    // 这里若用 `toISOString()`（UTC）会让这些条目凭空给 8 小时、排到列表最底下
    // （财联社快讯就因此整批进不了首页）。
    return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }

  const text = String(value).trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}/.test(text)) {
    return text.split(':').length >= 3 ? text : `${text}:00`;
  }
  if (/^\d{1,2}:\d{1,2}/.test(text)) {
    return `${new Date().toISOString().slice(0, 10)} ${text}:00`;
  }
  return text;
}

function getNested(obj: Record<string, unknown>, keys: string[], fallback: unknown): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return fallback;
    }
  }
  return current;
}
