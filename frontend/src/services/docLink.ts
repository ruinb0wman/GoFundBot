/**
 * Frontend doc-link helper for the "?" entries (市场大盘 / 基金筛选 / 策略研究等页面).
 *
 * Browser (incl. Electron desktop shells): the anchors carry `target="_blank"`
 * and the default navigation opens a normal new tab/window — `openDocLink` is a
 * passthrough no-op so the native anchor behavior takes over.
 *
 * 路径约定（规范化由调用方给定，本模块 verbatim 拼接）：
 * - 目录页（子目录含 index.md，如 `/docs/strategy/`、`/docs/fund-screening/`）
 *   必须带尾斜杠（不带会被 VitePress 302）；
 * - 文件页（根级 `market-*.md` 等，如 `/docs/market-index-trend`）
 *   必须不带尾斜杠（带斜杠 VitePress 会按目录找 index 而 404）。
 * 文档只能经前端 origin 的 `/docs` 代理渲染（直连文档服务 8574 不生效，实测）。
 */

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
 * Called from `@click="openDocLink($event, '/docs/xxx')"` (no `.prevent`
 * modifier): the anchor's `target="_blank"` default opens a new tab/window,
 * so this is intentionally a no-op in the browser.
 */
export function openDocLink(_event: Event, _path: string): void {
  // Browser default behavior (`target="_blank"`) handles the navigation.
}

export default openDocLink
