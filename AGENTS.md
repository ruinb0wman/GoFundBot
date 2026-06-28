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

`FUND_DEFAULT_SOURCE` env var controls the gray-release switch:
- `legacy` — old `fund_api.py` (default)
- `data_service` — DataService + legacy mapper
- `auto` — DataService first, quality-gate fallback to legacy

## Commands

```bash
# Backend (Python 3.11+)
pip install -r Backend/requirements.txt
python Backend/app.py
python Backend/tests/test_fund_industry_classification.py   # single test

# DataService (Node >= 18)
cd DataService && npm install
npm run dev              # tsx watch src/index.ts
npm run typecheck        # tsc --noEmit
npm run build && npm start

# Frontend
cd Frontend && npm install
npm run dev
npm run build            # output in Frontend/dist/, served by Flask in prod
```

## Key details

- **No CI/lint/formatter** configured for Python. DataService has `npm run typecheck`.
- **Database**: SQLite at `Backend/Data/funds.db`, auto-created on startup.
- **Cache TTLs** (DataService): fund estimates 30s, market quotes 15s, history 24h, dividends 7d.
- **Frontend Vite** proxies `/api` → `localhost:5000`; production: Flask serves `Frontend/dist/`.
- **gray/green akshare**: `DISABLE_AKSHARE_FALLBACK=1` env var to disable akshare as last resort.
- **Windows codepage**: PowerShell is GBK, code is UTF-8 — avoid viewing UTF-8 files in PowerShell.

## Monorepo hot spots

| Directory | What |
|-----------|------|
| `Backend/app.py` | ~3000-line Flask monolith — core business logic, routes, industry classification |
| `Backend/services/data_service_client.py` | DataService HTTP client — all external data fetch goes here |
| `Backend/ai_service.py` | LLM analysis via LangChain + OpenAI-compatible API |
| `DataService/src/` | TypeScript Express app with ProviderChain |

## Testing

- Single test: `Backend/tests/test_fund_industry_classification.py`
- Python built-in `unittest` (no pytest). Run with `python tests/...`.
