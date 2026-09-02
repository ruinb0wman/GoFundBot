/**
 * Environment-aware HTTP client adapter.
 *
 * Two deployment targets share the same frontend/src:
 * - Web build (Vite): browser fetch + `/api` Vite proxy (fallback to localhost:3100).
 * - Tauri desktop shell: WebView loads a running frontend service origin; all
 *   outbound HTTP goes through `@tauri-apps/plugin-http` (native) which bypasses
 *   browser CORS. Node API calls use the absolute `http://localhost:3100/api`
 *   address; external LLM / search APIs are also called directly via the plugin.
 *
 * Consumers keep the `{ data, status, ok }` response shape (axios-like) so the
 * existing `res.data` access patterns in api.ts / composables keep working.
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export interface HttpResponse<T = any> {
  data: T
  status: number
  ok: boolean
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  params?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  /** External absolute URL (LLM / search endpoints). When false, the URL is treated as an API path. */
  external?: boolean
}

const API_BASE = '/api'
const FALLBACK_API_BASE: string =
  import.meta.env.VITE_FALLBACK_API_BASE || 'http://localhost:3100/api'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Native fetch that works in both Web and Tauri (plugin-http) runtimes. */
export async function nativeFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauriRuntime()) {
    return tauriFetch(input, init)
  }
  return fetch(input, init)
}

function buildQueryString(baseUrl: string, params?: Record<string, unknown>): string {
  if (!params) return ''
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (entries.length === 0) return ''
  const sep = baseUrl.includes('?') ? '&' : '?'
  return (
    sep +
    entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
  )
}

/**
 * Resolve a request URL:
 * - external URLs are used as-is (desktop calls them via plugin-http directly);
 * - API paths (`/fund/...`, `api/...`, `http://localhost:3100/...`) are mapped
 *   to the Node base in Tauri and kept relative (Vite proxy) in Web.
 */
export function resolveUrl(url: string, params?: Record<string, unknown>): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url + buildQueryString(url, params)
  }
  const normalized = url.startsWith('/') ? url : `/${url}`
  const base = isTauriRuntime()
    ? (normalized.startsWith(API_BASE) ? FALLBACK_API_BASE : `${FALLBACK_API_BASE}${normalized}`)
    : (normalized.startsWith(API_BASE) ? normalized : `${API_BASE}${normalized}`)
  return base + buildQueryString(base, params)
}

/**
 * Generic HTTP request with timeout, used by api.ts and chat tools.
 * Returns `{ data, status, ok }` — `data` is the parsed JSON body.
 */
export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse<T>> {
  const {
    method = 'GET',
    params,
    body,
    headers = {},
    timeoutMs = 600000,
  } = options

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  }
  if (body !== undefined && body !== null) {
    requestHeaders['Content-Type'] = 'application/json'
  }

  try {
    const response = await nativeFetch(resolveUrl(url, params), {
      method,
      headers: requestHeaders,
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const text = await response.text()
    let data: unknown = text
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!response.ok) {
      // Throw an axios-like error so existing try/catch + err.response.data
      // error-handling patterns keep working.
      const error = new Error(`Request failed with status ${response.status}`) as Error & {
        response?: HttpResponse<unknown>
      }
      error.response = { data, status: response.status, ok: false }
      throw error
    }
    return { data: data as T, status: response.status, ok: response.ok }
  } finally {
    clearTimeout(timer)
  }
}

export const http = {
  get<T = unknown>(url: string, options?: HttpRequestOptions) {
    return httpRequest<T>(url, { ...options, method: 'GET' })
  },
  post<T = unknown>(url: string, body?: unknown, options?: HttpRequestOptions) {
    return httpRequest<T>(url, { ...options, method: 'POST', body })
  },
  put<T = unknown>(url: string, body?: unknown, options?: HttpRequestOptions) {
    return httpRequest<T>(url, { ...options, method: 'PUT', body })
  },
  delete<T = unknown>(url: string, options?: HttpRequestOptions) {
    return httpRequest<T>(url, { ...options, method: 'DELETE' })
  },
}
