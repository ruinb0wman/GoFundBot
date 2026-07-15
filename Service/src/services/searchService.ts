import { logger } from '../core/logger.js';
import { fetchUrl } from '../core/fetch.js';
import { getSearchSettings } from './settingsService.js';

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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// -------- Bocha --------

async function searchBocha(query: string, apiKey: string, maxResults: number): Promise<SearchResponse> {
  const url = 'https://api.bocha.cn/v1/web-search';
  const startTime = Date.now();

  let respText: string;
  try {
    respText = await fetchUrl(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, freshness: 'oneMonth', summary: true, count: Math.min(maxResults, 10) }),
      timeoutMs: 10000,
      proxy: 'never',
    });
  } catch {
    return { success: false, results: [], provider: 'Bocha', search_time: (Date.now() - startTime) / 1000, error: 'Request failed' };
  }

  let data: any;
  try {
    data = JSON.parse(respText);
  } catch {
    return { success: false, results: [], provider: 'Bocha', search_time: (Date.now() - startTime) / 1000, error: 'Invalid JSON' };
  }
  if (data.code !== 200) {
    return { success: false, results: [], provider: 'Bocha', search_time: (Date.now() - startTime) / 1000, error: data.msg };
  }

  const webPages = data.data?.webPages?.value ?? [];
  const results: SearchResultItem[] = webPages.slice(0, maxResults).map((item: any) => ({
    title: item.name ?? '',
    snippet: (item.summary ?? item.snippet ?? '').slice(0, 500),
    url: item.url ?? '',
    source: item.siteName ?? extractDomain(item.url ?? ''),
    date: item.datePublished ?? null,
  }));

  return { success: true, results, provider: 'Bocha', search_time: (Date.now() - startTime) / 1000 };
}

// -------- Tavily --------

async function searchTavily(query: string, apiKey: string, maxResults: number): Promise<SearchResponse> {
  const url = 'https://api.tavily.com/search';
  const startTime = Date.now();

  let respText: string;
  try {
    respText = await fetchUrl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: maxResults, days: 3 }),
      timeoutMs: 10000,
      proxy: 'never',
    });
  } catch {
    return { success: false, results: [], provider: 'Tavily', search_time: (Date.now() - startTime) / 1000, error: 'Request failed' };
  }

  let data: any;
  try {
    data = JSON.parse(respText);
  } catch {
    return { success: false, results: [], provider: 'Tavily', search_time: (Date.now() - startTime) / 1000, error: 'Invalid JSON' };
  }
  const items = data.results ?? [];
  const results: SearchResultItem[] = items.slice(0, maxResults).map((item: any) => ({
    title: item.title ?? '',
    snippet: (item.content ?? '').slice(0, 500),
    url: item.url ?? '',
    source: extractDomain(item.url ?? ''),
    date: item.published_date ?? null,
  }));

  return { success: true, results, provider: 'Tavily', search_time: (Date.now() - startTime) / 1000 };
}

// -------- DuckDuckGo (lite HTML scrape-free via api.duckduckgo.com) --------

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResponse> {
  const startTime = Date.now();

  let respText: string;
  try {
    respText = await fetchUrl(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { timeoutMs: 10000, proxy: 'never' },
    );
  } catch {
    return { success: false, results: [], provider: 'DuckDuckGo', search_time: (Date.now() - startTime) / 1000, error: 'Request failed' };
  }

  let data: any;
  try {
    data = JSON.parse(respText);
  } catch {
    return { success: false, results: [], provider: 'DuckDuckGo', search_time: (Date.now() - startTime) / 1000, error: 'Invalid JSON' };
  }
  const results: SearchResultItem[] = [];

  if (data.AbstractText) {
    results.push({
      title: data.Heading ?? '',
      snippet: data.AbstractText.slice(0, 500),
      url: data.AbstractURL ?? '',
      source: 'DuckDuckGo',
      date: null,
    });
  }

  const topics = data.RelatedTopics ?? [];
  for (const topic of topics.slice(0, maxResults - results.length)) {
    if (topic.Text) {
      results.push({
        title: topic.Text ?? '',
        snippet: topic.Text.slice(0, 500),
        url: topic.FirstURL ?? '',
        source: 'DuckDuckGo',
        date: null,
      });
    }
  }

  return { success: results.length > 0, results, provider: 'DuckDuckGo', search_time: (Date.now() - startTime) / 1000 };
}

// -------- Main --------

export async function searchWeb(query: string, maxResults = 5): Promise<SearchResponse> {
  if (!query) {
    return { success: false, results: [], provider: '', search_time: 0, error: 'query is required' };
  }

  const settings = getSearchSettings();

  const providers: Array<() => Promise<SearchResponse>> = [];

  if (settings.bochaKey) {
    providers.push(() => searchBocha(query, settings.bochaKey, maxResults));
  }
  if (settings.tavilyKey) {
    providers.push(() => searchTavily(query, settings.tavilyKey, maxResults));
  }
  providers.push(() => searchDuckDuckGo(query, maxResults));

  for (const search of providers) {
    try {
      const result = await search();
      if (result.success && result.results.length > 0) {
        return result;
      }
      logger.warn(`search provider ${result.provider} returned no results`, { error: result.error });
    } catch (error) {
      logger.warn(`search provider failed`, { error: String(error) });
    }
  }

  return { success: false, results: [], provider: 'None', search_time: 0, error: '所有搜索引擎都不可用或无结果' };
}
