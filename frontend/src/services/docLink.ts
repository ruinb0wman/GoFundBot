/**
 * Frontend doc-link helper for the "?" entries (市场大盘 / 基金筛选 / 策略研究等页面).
 *
 * - Web (browser): plain `<a href="/docs/..." target="_blank">` opens a new tab —
 *   this helper returns early and the anchor default behavior takes over.
 * - Tauri desktop: `target="_blank"` new-window requests are silently dropped by
 *   the WebView (and a dedicated second window proved unreliable), so clicks are
 *   routed to the in-app docs panel: `useDocsStore().openDocs()` renders a
 *   full-screen `<iframe>` (same-origin `/docs/...`) inside the main window —
 *   the same origin the main WebView already renders fine.
 *
 * 路径约定（规范化由调用方给定，本模块 verbatim 拼接）：
 * - 目录页（子目录含 index.md，如 `/docs/strategy/`、`/docs/fund-screening/`）
 *   必须带尾斜杠（不带会被 VitePress 302，WebView 初始加载跟随重定向链实测白屏）；
 * - 文件页（根级 `market-*.md` 等，如 `/docs/market-index-trend`）
 *   必须不带尾斜杠（带斜杠 VitePress 会按目录找 index 而 404）。
 * 文档只能经前端 origin 的 `/docs` 代理渲染（直连文档服务 8574 不生效，实测）。
 *
 * Self-contained on purpose: does not import `httpClient` so unit tests stay
 * free of the tauri plugin-http module chain.
 */

import { useDocsStore } from '../stores/docsStore'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Absolute docs URL for the current deployment origin (dev 8517 / prod 8417).
 * `path` must be the canonical '/docs/...' route (caller decides trailing
 * slash per the convention above); `origin` is injectable for testability and
 * defaults to the live location origin.
 */
export function docUrl(path: string, origin: string = window.location.origin): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${origin}${p}`
}

/**
 * Open the docs page for `path` (e.g. '/docs/strategy/').
 *
 * Called from `@click="openDocLink($event, '/docs/xxx')"` (no `.prevent` modifier):
 * - Browser: returns without touching the event — the anchor's
 *   `target="_blank"` opens a new tab as usual.
 * - Tauri: prevents the (unhandled) `target="_blank"` navigation and opens the
 *   in-app docs panel (full-screen iframe).
 */
export function openDocLink(event: Event, path: string): void {
  if (!isTauriRuntime()) return
  event.preventDefault()
  useDocsStore().openDocs(docUrl(path))
}

export default openDocLink
