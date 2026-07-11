# GoFundBot — Agent Guide

## Architecture

**Two services**, start in order:

1. **Service** (port 3100) — Node.js/Express/TypeScript unified backend
   - All API routes (`/api/fund/*`, `/api/market/*`, `/api/screening/*`, `/api/backtest/*`, etc.)
   - ProviderChain (stock-sdk → eastmoney → baidu/cls) for real-time financial data
   - PythonRunner: spawns Python scripts for computation (backtest, risk metrics)
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
Web search:       Express chatTools → runPython('search_web.py') → search_service.py → Bocha/Tavily/DDG → stdout JSON
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

# Python scripts (standalone, no Flask)
cd Scripts
echo '{"navHistory":[...]}' | python cli/backtest.py
python cli/fetch_fund.py --code 019667
python cli/compute_risk.py < input.json
python cli/classify_industry.py < input.json
python cli/data_complete.py --source akshare --type stocks
echo '{"query":"碳中和 政策","max_results":5}' | python cli/search_web.py
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
- **Health check**: `GET /api/health` — includes cache stats + SQLite availability.
- **Cache TTLs**: fund estimates 30s, market quotes 15s, history 24h, dividends 7d.
- **Graceful shutdown**: Service handles `SIGTERM`/`SIGINT` — 10s wait, then force exit.
- **Vite proxy**: `Frontend/vite.config.ts` proxies `/api` → `localhost:3100`.
- **Dexie.js**: All persistent data in IndexedDB, 10 tables in `Frontend/src/db/index.ts`.
- **Settings endpoint**: `GET/PUT /api/settings` — 统一 LLM/Proxy/Search 配置内存缓存，前端 localStorage 同步。
- **Search chain**: Bocha → Tavily → DuckDuckGo（自动降级，DDG 免费无需 Key）。

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
| `Scripts/cli/` | Python CLI scripts (backtest, fetch_fund, compute_risk, classify_industry, search_web) |
| `Scripts/cli/shared/` | Shared Python utilities (http_client) |
| `Scripts/services/*.py` | Python computation modules (backtest.py, risk_metrics.py, helpers.py) |
| `Scripts/services/ai_agent/` | Python AI Agent (chat loop, skill routing, tool handlers) |
| `Scripts/providers/` | Python data providers (eastmoney.py, tencent.py) |
| `Scripts/search_service.py` | Search engine service (Bocha → Tavily → DuckDuckGo) |
| `Frontend/src/db/` | Dexie schema (index.ts) — all IndexedDB table definitions |
| `Frontend/src/composables/` | Vue composables (useDexieCache, useFundWatchlist, useAppSettings, etc.) |
| `Frontend/src/stores/` | Pinia stores (watchlistStore updated with Dexie sync) |
| `Frontend/src/services/` | API client (api.ts, portfolioApi.ts, chatApi.ts) |

## Testing

```bash
# Service (Vitest)
cd Service && npm test

# Frontend (Vitest + @vue/test-utils)
cd Frontend && npx vue-tsc --noEmit && npm test
```
