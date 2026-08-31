# GoFundBot — Agent Guide

## Architecture

**Two services**, start in order:

1. **Service** (port 3100) — Node.js/Express/TypeScript unified backend
   - All API routes (`/api/fund/*`, `/api/market/*`, `/api/screening/*`, `/api/backtest/*`, etc.)
   - ProviderChain (stock-sdk → eastmoney → baidu/cls) for real-time financial data
   - PythonRunner: spawns Python scripts for computation (backtest)
   - AI analysis (via `openai` npm package)
2. **Frontend** (port 5173) — Vue 3 + Vite, proxies `/api` → Service

**Python** is tool-only (no HTTP server). Called via `child_process.spawn()` from Express:
```
stdin: JSON → Python compute → stdout: JSON
```

**All persistent data lives in IndexedDB** (Dexie.js) on the frontend:
- User data: watchlist, portfolio, trades, positions, alerts, chat history
- Cache: fund details, NAV history, market data

## Data flow

```
Real-time data:   ProviderChain → Express → Frontend → IndexedDB (Dexie)
User data CRUD:   Frontend → IndexedDB (Dexie) — no server round-trip
Backtest:         Express → PythonRunner.spawn('backtest.py') → stdout JSON → Frontend → Dexie
Data completion:  Python scripts via CLI → fetch from akshare/eastmoney → stdout JSON → Express
Screening enrichment: Express → fetch NAV + fund list → TypeScript risk/industry → merge into sync
Web search:       Express chatTools → searchService → Exa/Bocha/Tavily/DDG → ServiceResult
Settings:         Frontend (localStorage) → PUT /api/settings → Express settingsService (memory cache)
```

## Commands

```bash
# Service (Node >= 18) — THE main backend
cd Service && npm install
npm run dev              # tsx watch src/index.ts (port 3100)
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint (max-lines 500)
npm test                 # vitest run (67+ tests)
npm run build && npm start

# Frontend
cd Frontend && npm install
npm run dev              # port 5173, proxy /api → localhost:3100
npm run lint             # ESLint (max-lines 500, Vue/TS)
npx vue-tsc --noEmit     # TypeScript typecheck
npm test                 # vitest run
npm run build            # output in Frontend/dist/

# Python scripts (standalone, no HTTP server)
cd Scripts
echo '{"navHistory":[...]}' | Scripts/.venv/bin/python cli/backtest.py
Scripts/.venv/bin/python cli/fetch_fund.py --code 019667
Scripts/.venv/bin/python cli/data_complete.py --source akshare --type stocks

# Docs (VitePress)
cd docs && npm install
npm run dev              # port 5174, proxied via Frontend /docs/*
npm run build            # output in docs/.vitepress/dist/
```

## CI/CD

```yaml
dataservice: npm run lint → npm run typecheck → npm test
frontend:  npm run lint → npx vue-tsc --noEmit → npm test → npm run build
```

Both services enforce single-file max 500 lines. Violations block CI.

## Key details

- **Rate limiting**: `express-rate-limit` (300/15min).
- **Input validation**: Zod schemas on key POST routes.
- **Security headers**: Service uses `helmet` (CSP/COEP disabled).
- **Structured logging**: JSON via `core/logger.ts` (Service) with `requestId` per request. Daily files `dataservice-YYYY-MM-DD.jsonl` under `Scripts/Data/logs`.
- **Health check**: `GET /api/health` — includes cache stats.
- **Cache TTLs**: fund estimates 30s, market quotes 15s, history 24h, dividends 7d.
- **Graceful shutdown**: Service handles `SIGTERM`/`SIGINT` — 10s wait, then force exit.
- **Vite proxy**: `Frontend/vite.config.ts` proxies `/api` → `localhost:3100`, `/docs` → `localhost:5174`.
- **Dexie.js**: All persistent data in IndexedDB, 10 tables in `Frontend/src/db/index.ts`.
- **Settings endpoint**: `GET/PUT /api/settings` — 统一 LLM/Proxy/Search 配置内存缓存，前端 localStorage 同步。
- **Search chain**: Exa（MCP/JSON-RPC，免费无 Key）→ Bocha → Tavily → DuckDuckGo（自动降级）。
- **Screening data refresh**: 筛选页 onMounted + localStorage 持久化 `lastSyncTime` → 检测过期（今日 9AM）→ 强制 `force=true` 全量刷新。AI chat `get_industry_performance` 共享同一缓存（cacheThrough TTL=次日 9AM）。
- **Proxy**: 国内 API（东方财富）用 `proxy: 'never'` 直连；Yahoo Finance（被封）走 `proxy: 'auto'` 随代理配置。`eastmoneyRequest.ts` 统一添加 `Referer` 头防止反爬。
- **Docs**: VitePress 构建的文档站，配置在 `docs/.vitepress/config.ts`（nav + sidebar）。模块级详细文档按功能目录组织（如 `docs/fund-screening/`），在侧边栏对应分组。文档通过 Frontend `/docs/*` 代理访问。

> 模块级详细文档见 `docs/` 目录（VitePress 构建），每个功能模块对应独立的 `.md` 文件或目录，侧边栏分组见 `docs/.vitepress/config.ts`。

## Monorepo hot spots

| Directory | What |
|-----------|------|
| `Service/src/` | Express app with ProviderChain, all routes |
| `Service/src/app.ts` | App bootstrap — route registration, middleware |
| `Service/src/routes/` | All Express route handlers (fund, market, screening, backtest, settings, etc.) |
| `Service/src/services/` | Business logic (fundService, riskMetrics, industry, screeningEnrichment, pythonRunner, cache, settingsService, chatTools/chatSkills) |
| `Service/src/providers/` | ProviderChain implementations (stock-sdk, eastmoney, tencent, yahoo) |
| `Service/src/core/` | Infrastructure (logger, cache, errors, response, providerChain) |
| `Service/src/types/` | DTO interfaces (fund.ts, common.ts) |
| `Scripts/cli/` | Python CLI scripts (backtest, fetch_fund, data_complete) |
| `Scripts/cli/shared/` | Shared Python utilities (http_client) |
| `Scripts/services/*.py` | Python computation modules (backtest.py, helpers.py) |
| `Service/src/services/searchService.ts` | Search engine chain (Exa → Bocha → Tavily → DuckDuckGo) |
| `Frontend/src/db/` | Dexie schema (index.ts) — all IndexedDB table definitions |
| `Frontend/src/composables/` | Vue composables (useDexieCache, useFundWatchlist, useAppSettings, etc.) |
| `Frontend/src/stores/` | Pinia stores (watchlistStore updated with Dexie sync) |
| `Frontend/src/services/` | API client (api.ts, portfolioApi.ts, chatApi.ts) |
| `docs/` | VitePress 文档站（`docs/.vitepress/config.ts` 导航/侧边栏配置） |
| `packages/ui/` | **UI 组件库 `@gofund/ui`** — B* 系列表单控件与浮层/反馈组件、设计 token（明暗双主题）、composables；Vite lib mode 构建（组件级 chunk + dts）；Frontend 经 vite/tsconfig 别名直连 `packages/ui/src/index.ts`（`@gofund/ui`），开发 HMR 与构建均从源；`file:../packages/ui` 仅为发布用依赖声明 |
| `docs/fund-screening/` | 基金筛选模块细分文档（概览/数据流/筛选面板/指标丰富化/4433法则） |
| `docs/market-*.md` | 市场数据各功能模块说明文档 |
| `docs/architecture/` | 技术架构文档（数据源/数据流/回退策略/AI分析等） |

## Testing

```bash
# Service (Vitest)
cd Service && npm test

# Frontend (Vitest + @vue/test-utils)
cd Frontend && npx vue-tsc --noEmit && npm test
```

## Known issues

### 今日资金流向 (market money flow)

EastMoney `push2*` 子域名的 `/api/qt/stock/fflow/daykline/get` 接口被反爬封锁（SSL EOF），
无法获取分订单规模（主力/超大单/大单/中单/小单）的沪深合计资金流数据。

**现状**：
- EastMoney push2 不可用后自动走 Akshare 回退（`data_complete.py --source akshare --type money_flow`）
- Akshare 返回格式与 EastMoney 一致（`MarketMoneyFlowDto`），覆盖 5 个字段
- `getMarketMoneyFlow()` 在两种数据源均失败时返回空数据，前端显示"暂无数据"

**历史修复**：
- **2026-07-28** — 前端资金流向图表修复：`categories` 从 `['主力', '机构', '大户', '散户']` 改为 `['机构', '大户', '中户', '散户']`，values 映射从 `[mainNetInflow, superLargeNetInflow, largeNetInflow, smallNetInflow]` 改为 `[superLargeNetInflow, largeNetInflow, mediumNetInflow, smallNetInflow]`
  - 修复前：`mainNetInflow = superLargeNetInflow + largeNetInflow`，买入侧重复计算翻倍，且遗漏 `mediumNetInflow`
  - 修复后：4 栏互斥，标签与订单分类对齐，详见 `docs/market-money-flow.md`
