/**
 * Server-side web-search chain（无 key）：Exa（免费） → DuckDuckGo。
 *
 * 移植自 `frontend/src/services/searchService.ts`。Node 核心化（P1）时曾经
 * 支持 Bocha/Tavily，但应用不再持有任何第三方密钥（pi 是唯一 AI），
 * 所以只保留免费链路。
 */
import { fetchUrl } from '../core/fetch.js';

export interface SearchResultItem {
  title: string;
  snippet: string;
  url: string;
  source: string;
  date: string | null;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResultItem[];
  provider: string;
  search_time: number;
  error?: string;
}

type Json = Record<string, any>;

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function failed(provider: string, startedAt: number, error: string): SearchResponse {
  return { success: false, results: [], provider, search_time: (Date.now() - startedAt) / 1000, error };
}

/** Exa 的 MCP 信封：可能是 JSON，也可能是 SSE 行。 */
function parseMcpResponse(body: string): string | null {
  const collect = (payload: Json): string | null => {
    const content = payload?.result?.content;
    if (Array.isArray(content)) {
      const textItem = content.find((c: Json) => typeof c.text === 'string' && c.text.length > 0);
      if (textItem) return textItem.text as string;
    }
    return null;
  };

  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const found = collect(JSON.parse(trimmed));
      if (found) return found;
    } catch {
      // fall through to the SSE scan
    }
  }
  for (const line of trimmed.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data: ')) continue;
    try {
      const found = collect(JSON.parse(s.slice(6)));
      if (found) return found;
    } catch {
      // continue
    }
  }
  return null;
}

async function searchExa(query: string, maxResults: number): Promise<SearchResponse> {
  const startedAt = Date.now();
  let text: string;
  try {
    text = await fetchUrl<string>('https://mcp.exa.ai/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'web_search_exa',
          arguments: { query, type: 'auto', numResults: maxResults, livecrawl: 'fallback' },
        },
      }),
      timeoutMs: 25_000,
      proxy: 'auto',
    });
  } catch (error) {
    return failed('Exa', startedAt, `Request failed: ${String(error)}`);
  }

  const payload = parseMcpResponse(text);
  if (!payload) return failed('Exa', startedAt, 'No results in response');

  try {
    const json = JSON.parse(payload);
    if (Array.isArray(json)) {
      const results: SearchResultItem[] = json.slice(0, maxResults).map((item: Json) => ({
        title: item.title ?? '',
        snippet: String(item.content ?? item.snippet ?? '').slice(0, 500),
        url: item.url ?? '',
        source: item.siteName ?? extractDomain(item.url ?? ''),
        date: item.published_date ?? item.date ?? null,
      }));
      return {
        success: results.length > 0,
        results,
        provider: 'Exa',
        search_time: (Date.now() - startedAt) / 1000,
      };
    }
  } catch {
    // 不是 JSON，按纯文本处理
  }

  return {
    success: true,
    results: [{ title: `搜索结果：${query.slice(0, 80)}`, snippet: payload.slice(0, 500), url: '', source: 'Exa', date: null }],
    provider: 'Exa',
    search_time: (Date.now() - startedAt) / 1000,
  };
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResponse> {
  const startedAt = Date.now();
  let data: Json;
  try {
    const text = await fetchUrl<string>(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { timeoutMs: 10_000, proxy: 'auto' }
    );
    data = JSON.parse(text) as Json;
  } catch (error) {
    return failed('DuckDuckGo', startedAt, `Request failed: ${String(error)}`);
  }

  const results: SearchResultItem[] = [];
  if (data.AbstractText) {
    results.push({
      title: data.Heading ?? '',
      snippet: String(data.AbstractText).slice(0, 500),
      url: data.AbstractURL ?? '',
      source: 'DuckDuckGo',
      date: null,
    });
  }
  for (const topic of (data.RelatedTopics ?? []).slice(0, Math.max(0, maxResults - results.length))) {
    if (!topic?.Text) continue;
    results.push({
      title: topic.Text,
      snippet: String(topic.Text).slice(0, 500),
      url: topic.FirstURL ?? '',
      source: 'DuckDuckGo',
      date: null,
    });
  }
  return {
    success: results.length > 0,
    results,
    provider: 'DuckDuckGo',
    search_time: (Date.now() - startedAt) / 1000,
  };
}

/** 按顺序尝试；第一个有结果的返回。 */
export async function searchWeb(query: string, maxResults = 5): Promise<SearchResponse> {
  if (!query) {
    return { success: false, results: [], provider: '', search_time: 0, error: 'query is required' };
  }
  const limit = Number.isFinite(maxResults) && maxResults > 0 ? Math.min(Math.floor(maxResults), 20) : 5;

  for (const search of [() => searchExa(query, limit), () => searchDuckDuckGo(query, limit)]) {
    try {
      const result = await search();
      if (result.success && result.results.length > 0) return result;
    } catch {
      // 试下一个
    }
  }
  return { success: false, results: [], provider: 'None', search_time: 0, error: '所有搜索引擎都不可用或无结果' };
}
