# Tauri 2 桌面壳（CORS 解禁）

> 定位：**仅作为「解禁浏览器 CORS 限制的壳」**。Tauri 不打包前端资源，WebView
> 加载的是**仍在运行的前端服务** origin——使用时需另外启动前端服务
> （dev: `vite`；prod: 本地静态托管 `frontend/dist`）。

## 双部署目标

```
┌─ 桌面目标：Tauri 2 壳（仅解禁 CORS + 原生 fetch）────────────────────────┐
│  WebView 加载源 = 运行中的前端服务 origin                                  │
│  dev : http://localhost:5173（vite）                                      │
│  prod: http://localhost:4173（vite preview / serve 静态托管 dist）         │
└───────────────┬──────────────────────────────────────────────────────────┘
┌───────────────▼────────────────── 同一份 frontend/src ─────────────────────┐
│  全部业务逻辑（筛选丰富化/行业风险/排名/4433）＋ AI（前端直调 LLM）＋        │
│  联网搜索（Bocha/Tavily/Exa/DDG 直调）＋ 设置（key 存前端）＋ 用户数据        │
├───────────────「出站 HTTP」───────────────────────────────────────────────┤
│  桌面：tauri-plugin-http（原生，绕 CORS）→ Node(localhost:3100) / 外部 API  │
│  Web ：浏览器 fetch → /api Vite 代理 → Node                                 │
└───────────────┬──────────────────────────────────────────────────────────┘
┌───────────────▼────────── Node 薄后端（独立本地服务 localhost:3100）────────┐
│  ProviderChain 实时数据 │ 驱动 Python（data_complete/backtest）│ 反爬/代理 │
│  /api/screening 返回原始数据 │ /api/settings 仅 proxy 子域 │ 最小配置接口  │
└──────────────────────────────────────────────────────────────────────────┘
```

## 目录结构

| 路径 | 说明 |
|------|------|
| `tauri/package.json` | 独立 npm 包（`gofund-tauri`）：dev/build = `tauri dev`/`tauri build`，devDep `@tauri-apps/cli` |
| `tauri/src-tauri/Cargo.toml` | Rust 依赖：`tauri` + `tauri-plugin-http` |
| `tauri/src-tauri/tauri.conf.json` | `build.devUrl` / `build.frontendDist` 为前端服务地址（远程 URL） |
| `tauri/src-tauri/capabilities/remote-webview.json` | **远程 origin IPC 放行**（见下） |
| `tauri/src-tauri/src/lib.rs` | `tauri::Builder` + `tauri_plugin_http::init()` |
| `frontend/src/services/httpClient.ts` | 环境感知 HTTP 适配器（Web fetch ↔ tauri plugin-http） |

## 远程 origin 的 IPC 放行（关键前提）

WebView 加载的是**远程 origin**（`http://localhost:5173` 等）而非 `tauri://`。
默认情况下远程页面无权调用 Tauri 插件/核心 API，`tauri-plugin-http` 会被拦截。
Tauri v2 的放行机制是 **capability 的 `remote` 字段**（替代 v1 的
`dangerousRemoteDomainIpcAccess`）：

```json
// tauri/src-tauri/capabilities/remote-webview.json
{
  "identifier": "gofund-remote-webview",
  "windows": ["main"],
  "remote": {
    "urls": ["http://localhost:5173", "http://localhost:4173"]
  },
  "permissions": ["http:default", "core:default"]
}
```

- `remote.urls` 与 `tauri.conf.json` 的 `devUrl` / `frontendDist` 保持一致；
  修改前端服务地址时需同步更新。
- `http:default` 授予 `tauri-plugin-http` 调用权限；`core:default` 授予核心 API。

## 启动约定（桌面）

```bash
# 1) Node 薄后端（独立）
cd service && npm run dev                 # localhost:3100

# 2) 前端服务（独立）——dev 或 prod 静态托管
cd frontend && npm run dev --host         # localhost:5173   (dev)
cd frontend && npm run build && npm run preview   # localhost:4173 (prod 静态托管)

# 3) Tauri 壳（另开终端）
cd tauri && npm run dev                  # = tauri dev
```

或根目录一键（Node + vite + tauri 并行，concurrently）：`npm run dev:desktop`。

## httpClient 适配器

`frontend/src/services/httpClient.ts`：

| 运行时 | 检测 | Node API | 外部 API（LLM/搜索） |
|--------|------|----------|----------------------|
| Web | — | `/api` Vite 代理（网络错误回落 `localhost:3100`） | 浏览器 fetch（受 CORS 限制） |
| 桌面 | `window.__TAURI_INTERNALS__` | `http://localhost:3100/api`（plugin-http 直连，绕 CORS） | plugin-http 直连（绕 CORS） |

`api.ts` 的业务调用签名不变（`res.data`），底层按环境路由。`/api/chat` 等
SSE 端点已撤销——对话由前端 `chatEngine` 直接驱动 LLM 流式接口。

## 自检清单（桌面端）

1. `tauri.conf.json` 的 `devUrl` / `frontendDist` 与 capability `remote.urls` 一致。
2. 前端服务已启动（`curl http://localhost:5173` 可达）。
3. Node 已启动（`curl http://localhost:3100/api/health` 可达）。
4. 首次 `cargo check` 需要系统库：Linux 需 `webkit2gtk-4.1 / gtk3 / atk` 等
   （`sudo apt install libwebkit2gtk-4.1-dev build-essential ...`）；
   `tauri/src-tauri` 构建 CI 步可选（需 Rust 环境）。