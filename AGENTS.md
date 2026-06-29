# GoFundBot — Agent Guide

## Architecture

Three independent services, **start in order**:

1. **DataService** (port 3100) — Node.js/Express/TypeScript data gateway
2. **Backend** (port 5000) — Flask monolith (business logic, AI, DB)
3. **Frontend** (port 5173) — Vue 3 + Vite, proxies `/api` → backend

## Critical data-flow rule

**Backend MUST NOT call any third-party finance API directly.** All external finance-data access goes through:

```
Backend/services/data_service_client.py → DataService → ProviderChain (stock-sdk → eastmoney → baidu/cls)
```

`FUND_DEFAULT_SOURCE` env var controls the default data source:
- `data_service` — DataService + legacy mapper (default)
- `auto` — DataService first, quality-gate fallback to legacy
- `legacy` — old `fund_api.py` (deprecated, keep as escape hatch)

## Commands

```bash
# Backend (Python 3.11+)
pip install -r Backend/requirements.txt
python Backend/app.py
python Backend/tests/test_fund_industry_classification.py   # single test
ruff check Backend/          # linter
ruff format Backend/ --check # format check

# DataService (Node >= 18)
cd DataService && npm install
npm run dev              # tsx watch src/index.ts
npm run typecheck        # tsc --noEmit
npm run build && npm start

# Frontend
cd Frontend && npm install
npm run dev
npx vue-tsc --noEmit     # TypeScript typecheck
npm run build            # output in Frontend/dist/, served by Flask in prod

# Pre-commit hooks (optional, for development)
pip install pre-commit && pre-commit install
```

## CI/CD

`.github/workflows/ci.yml` — 三服务并行矩阵流水线:

```yaml
backend:   ruff check → ruff format --check → python unittest
dataservice: npm run typecheck → npm test
frontend:  npx vue-tsc --noEmit → npm test → npm run build
```

## Key details

- **Pre-commit hooks** are set up in `.pre-commit-config.yaml` — `detect-private-key` + .env prevention. Install with `pip install pre-commit && pre-commit install`.
- **Python** lint/format via ruff (configured in `Backend/pyproject.toml`). DataService has `npm run typecheck`.
- **Rate limiting**: Flask-Limiter (200/day, 50/hour default; AI endpoints 10/hour, write endpoints 30/hour) + `express-rate-limit` (300/15min).
- **Input validation**: Pydantic `@validate_body` / `@validate_query` decorators on key POST/PUT routes (`schemas/`).
- **CORS**: `CORS_ORIGINS` env var controls allowed origins (comma-separated, `*` = all).
- **Security headers**: DataService uses `helmet` (CSP/COEP disabled).
- **Structured logging**: JSON format via `core/logging.py` (Backend) and `core/logger.ts` (DataService) with `requestId` per request.
- **Health check**: Backend `GET /health` — deep check (DB + DataService). DataService `GET /api/health` includes cache stats.
- **Metrics**: Prometheus client at `/metrics` — `http_requests_total`, `http_request_duration_seconds`, `db_connections_active`, etc.
- **Graceful shutdown**: Both services handle `SIGTERM`/`SIGINT` — 10s wait for in-flight requests, then force exit.
- **API versioning**: Progressive `/api/v1/` rollout. Old routes marked `@deprecated_route` (returns `X-Deprecated` header).
- **API docs**: Swagger UI at `/api/docs` via flasgger. `@swag_from` decorators on v1 endpoints.
- **Config validation**: `config.py:validate()` checks `LLM_API_KEY` and `DATA_SERVICE_BASE_URL` at startup.
- **Database**: SQLite at `Backend/Data/funds.db`, auto-created on startup.
- **Cache TTLs** (DataService): fund estimates 30s, market quotes 15s, history 24h, dividends 7d.
- **Frontend Vite** proxies `/api` → `localhost:5000`; production: Flask serves `Frontend/dist/`.
- **gray/green akshare**: `DISABLE_AKSHARE_FALLBACK=1` env var to disable akshare in legacy Backend path (DataService no longer uses akshare).
- **Windows codepage**: PowerShell is GBK, code is UTF-8 — avoid viewing UTF-8 files in PowerShell.

## Monorepo hot spots

| Directory | What |
|-----------|------|
| `Backend/app.py` | 266-line bootstrap — blueprint registration, middleware, graceful shutdown |
| `Backend/services/data_service_client.py` | DataService HTTP client — all external data fetch goes here |
| `Backend/ai_service.py` | LLM analysis via LangChain + OpenAI-compatible API |
| `Backend/schemas/` | Pydantic input validation models |
| `Backend/core/validation.py` | `@validate_body` / `@validate_query` decorators |
| `Backend/core/logging.py` | Structured JSON logging setup |
| `Backend/core/metrics.py` | Prometheus metrics (`/metrics` endpoint) |
| `Backend/core/version_shim.py` | `@deprecated_route` decorator for API versioning |
| `Backend/routes/` | 6 route blueprints (fund, screening, watchlist, research, backtest, system) |
| `Backend/routes_v1/` | API v1 blueprints (progressive rollout) |
| `Backend/schemas/apidoc.py` | Swagger OpenAPI response models |
| `Backend/config.py` | Config validation on startup |
| `Backend/services/industry_classification.py` | Industry classification core logic |
| `DataService/src/` | TypeScript Express app with ProviderChain |
| `Frontend/src/` | Vue 3 + TypeScript + `<script setup lang="ts">` (全量迁移完成); `composables/` 含 `useSearchHistory` / `useOnlineStatus` / `useBreakpoint` / `useChartResize` / `useNotification`; `components/` 含 `OfflineBanner` / `ErrorBoundary` / `HamburgerButton` / `MobileDrawer` / `BottomNav` / `AlertBadge` / `AlertSettings` |
| `Backend/models.py` | SQLAlchemy 模型: AlertRule (告警规则) |
| `Backend/routes/alert_routes.py` | 告警 CRUD + 检查 + 市场异动 API |
| `Backend/schemas/alert_schemas.py` | Pydantic 校验: AlertRuleCreateSchema / AlertRuleUpdateSchema |
| `Backend/services/market_alert.py` | 市场异动检测 (指数涨跌 >3%) |
| `Frontend/src/stores/alertStore.ts` | Pinia store: 告警规则管理 |
| `Frontend/src/utils/exportUtils.ts` | CSV 导出工具函数 |
| `Frontend/src/locales/` | vue-i18n 国际化 (zh-CN / en) |
| `Frontend/src/components/LocaleSwitcher.vue` | 语言切换按钮 (Header) |
| `Backend/services/backtest_strategies.py` | 定投策略推荐引擎 (MA/价值平均策略对比) |
| `Frontend/tsconfig.json` | TypeScript strict mode config |
| `.pre-commit-config.yaml` | Pre-commit hooks (private key + .env check) |

## Testing

**Backend** (Python unittest):
```bash
# Run all Backend tests
Backend/.venv/bin/python -m unittest discover -s Backend/tests -v

# Single test
Backend/.venv/bin/python Backend/tests/test_fund_industry_classification.py

# Coverage
Backend/.venv/bin/pip install coverage
Backend/.venv/bin/coverage run -m unittest discover -s Backend/tests
Backend/.venv/bin/coverage report --omit="tests/*"
```

**DataService** (Vitest):
```bash
cd DataService && npm test          # vitest run
cd DataService && npm run test:watch  # vitest watch
cd DataService && npx vitest run --coverage  # with coverage (needs @vitest/coverage-v8)
```

**Frontend** (Vitest + @vue/test-utils):
```bash
cd Frontend && npx vue-tsc --noEmit  # TypeScript typecheck
cd Frontend && npm test              # vitest run
cd Frontend && npm run test:watch    # vitest watch
```

**All services** (from repo root):
```bash
# Backend
/usr/bin/python3 -m unittest discover -s Backend/tests -v

# DataService
cd DataService && npx vitest run

# Frontend
cd Frontend && npx vue-tsc --noEmit && npx vitest run
```
