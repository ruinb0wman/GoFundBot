/**
 * Frontend web-search chain: Exa (free) → Bocha → Tavily → DuckDuckGo.
 * Ported from Service `searchService.ts`. Keys come from frontend settings
 * (useAppSettings); requests go through nativeFetch (browser on Web,
 * tauri-plugin-http on desktop).
 */

import { nativeFetch } from './httpClient'
import type { AppSettings } from '../composables/useAppSettings'

export interface SearchResultItem {
  title: string
  snippet: string
  url: string
  source: string
  date: string | null
}

export interface SearchResponse {
  success: boolean
  results: SearchResultItem[]
  provider: string
  search_time: number
  error?: string
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function fetchText(url: string, init?: RequestInit, timeoutMs = 10000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await nativeFetch(url, { ...init, signal: controller.signal })
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

async function searchBocha(query: string, apiKey: string, maxResults: number): Promise<SearchResponse> {
  const url = 'https://api.bocha.cn/v1/web-search'
  const startTime = Date.now()
  let respText: string
  try {
    respText = await fetchText(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, freshness: 'oneMonth', summary: true, count: Math.min(maxResults, 10) }),
    })
  } catch {
    return { success: false, results: [], provider: 'Bocha', search_time: (Date.now() - startTime) / 1000, error: 'Request failed' }
  }

  let data: any
  try {
    data = JSON.parse(respText)
  } catch {
    return { success: false, results: [], provider: 'Bocha', search_time: (Date.now() - startTime) / 1000, error: 'Invalid JSON' }
  }
  if (data.code !== 200) {
    return { success: false, results: [], provider: 'Bocha', search_time: (Date.now() - startTime) / 1000, error: data.msg }
  }

  const webPages = data.data?.webPages?.value ?? []
  const results: SearchResultItem[] = webPages.slice(0, maxResults).map((item: any) => ({
    title: item.name ?? '',
    snippet: (item.summary ?? item.snippet ?? '').slice(0, 500),
    url: item.url ?? '',
    source: item.siteName ?? extractDomain(item.url ?? ''),
    date: item.datePublished ?? null,
  }))

  return { success: true, results, provider: 'Bocha', search_time: (Date.now() - startTime) / 1000 }
}

async function searchTavily(query: string, apiKey: string, maxResults: number): Promise<SearchResponse> {
  const url = 'https://api.tavily.com/search'
  const startTime = Date.now()
  let respText: string
  try {
    respText = await fetchText(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: maxResults, days: 3 }),
    })
  } catch {
    return { success: false, results: [], provider: 'Tavily', search_time: (Date.now() - startTime) / 1000, error: 'Request failed' }
  }

  let data: any
  try {
    data = JSON.parse(respText)
  } catch {
    return { success: false, results: [], provider: 'Tavily', search_time: (Date.now() - startTime) / 1000, error: 'Invalid JSON' }
  }
  const items = data.results ?? []
  const results: SearchResultItem[] = items.slice(0, maxResults).map((item: any) => ({
    title: item.title ?? '',
    snippet: (item.content ?? '').slice(0, 500),
    url: item.url ?? '',
    source: extractDomain(item.url ?? ''),
    date: item.published_date ?? null,
  }))

  return { success: true, results, provider: 'Tavily', search_time: (Date.now() - startTime) / 1000 }
}

async function searchExa(query: string, apiKey: string, maxResults: number): Promise<SearchResponse> {
  const baseUrl = apiKey
    ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(apiKey)}`
    : 'https://mcp.exa.ai/mcp'
  const startTime = Date.now()

  let respText: string
  try {
    respText = await fetchText(
      baseUrl,
      {
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
      },
      25000,
    )
  } catch {
    return { success: false, results: [], provider: 'Exa', search_time: (Date.now() - startTime) / 1000, error: 'Request failed' }
  }

  const text = parseMcpResponse(respText)
  if (!text) {
    return { success: false, results: [], provider: 'Exa', search_time: (Date.now() - startTime) / 1000, error: 'No results in response' }
  }

  try {
    const json = JSON.parse(text)
    if (Array.isArray(json)) {
      const results: SearchResultItem[] = json.slice(0, maxResults).map((item: any) => ({
        title: item.title ?? '',
        snippet: (item.content ?? item.snippet ?? '').slice(0, 500),
        url: item.url ?? '',
        source: item.siteName ?? extractDomain(item.url ?? ''),
        date: item.published_date ?? item.date ?? null,
      }))
      return { success: results.length > 0, results, provider: 'Exa', search_time: (Date.now() - startTime) / 1000 }
    }
  } catch {
    // Not JSON, treat as plain text below
  }

  const results: SearchResultItem[] = [{
    title: `搜索结果：${query.slice(0, 80)}`,
    snippet: text.slice(0, 500),
    url: '',
    source: 'Exa',
    date: null,
  }]
  return { success: true, results, provider: 'Exa', search_time: (Date.now() - startTime) / 1000 }
}

function parseMcpResponse(body: string): string | null {
  const trimmed = body.trim()
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed)
      const content = data?.result?.content
      if (Array.isArray(content)) {
        const textItem = content.find((c: any) => typeof c.text === 'string' && c.text.length > 0)
        if (textItem) return textItem.text
      }
    } catch {
      // fall through
    }
  }
  for (const line of trimmed.split('\n')) {
    const s = line.trim()
    if (s.startsWith('data: ')) {
      try {
        const data = JSON.parse(s.substring(6))
        const content = data?.result?.content
        if (Array.isArray(content)) {
          const textItem = content.find((c: any) => typeof c.text === 'string' && c.text.length > 0)
          if (textItem) return textItem.text
        }
      } catch {
        // continue
      }
    }
  }
  return null
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResponse> {
  const startTime = Date.now()
  let respText: string
  try {
    respText = await fetchText(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    )
  } catch {
    return { success: false, results: [], provider: 'DuckDuckGo', search_time: (Date.now() - startTime) / 1000, error: 'Request failed' }
  }

  let data: any
  try {
    data = JSON.parse(respText)
  } catch {
    return { success: false, results: [], provider: 'DuckDuckGo', search_time: (Date.now() - startTime) / 1000, error: 'Invalid JSON' }
  }
  const results: SearchResultItem[] = []

  if (data.AbstractText) {
    results.push({
      title: data.Heading ?? '',
      snippet: data.AbstractText.slice(0, 500),
      url: data.AbstractURL ?? '',
      source: 'DuckDuckGo',
      date: null,
    })
  }

  const topics = data.RelatedTopics ?? []
  for (const topic of topics.slice(0, maxResults - results.length)) {
    if (topic.Text) {
      results.push({
        title: topic.Text ?? '',
        snippet: topic.Text.slice(0, 500),
        url: topic.FirstURL ?? '',
        source: 'DuckDuckGo',
        date: null,
      })
    }
  }

  return { success: results.length > 0, results, provider: 'DuckDuckGo', search_time: (Date.now() - startTime) / 1000 }
}

export async function searchWeb(
  query: string,
  maxResults = 5,
  settings?: AppSettings,
): Promise<SearchResponse> {
  if (!query) {
    return { success: false, results: [], provider: '', search_time: 0, error: 'query is required' }
  }

  const searchSettings = settings?.search ?? { bochaKey: '', tavilyKey: '' }

  const providers: Array<() => Promise<SearchResponse>> = []
  if (searchSettings.bochaKey) providers.push(() => searchBocha(query, searchSettings.bochaKey, maxResults))
  if (searchSettings.tavilyKey) providers.push(() => searchTavily(query, searchSettings.tavilyKey, maxResults))
  providers.push(() => searchExa(query, '', maxResults))
  providers.push(() => searchDuckDuckGo(query, maxResults))

  for (const search of providers) {
    try {
      const result = await search()
      if (result.success && result.results.length > 0) {
        return result
      }
    } catch {
      // try next provider
    }
  }

  return { success: false, results: [], provider: 'None', search_time: 0, error: '所有搜索引擎都不可用或无结果' }
}
