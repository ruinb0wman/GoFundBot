# GoFundBot data extension for pi

Gives a terminal `pi` session (run from this repo) **read-only** access to GoFundBot's
market / fund / news data. It is a thin adapter over the existing Express routes —
it adds no service code and does not touch the frontend.

```bash
# terminal A — start the data service
cd service && bun run dev

# terminal B — repo root
pi
# then just ask: "今天大盘怎么样，前 5 个热门板块是什么"
```

The first time pi runs in this directory it asks for **project trust** (project
extensions load only after that). If the service is not running, tools fail with a
message saying so rather than returning empty data.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `GOFUND_API_BASE` | `http://localhost:8310` | Service origin |

## Tools (15)

| Tool | Request | Notes |
|---|---|---|
| `search_funds` | `GET /api/fund/search?q=` | legacy route; `data = [{CODE,NAME,TYPE,PINYIN}]` |
| `get_fund_detail` | `GET /api/fund/:code` | legacy aggregate; **time series are summarized** (see below) |
| `get_fund_estimate` | `GET /api/funds/:code/estimate` | |
| `get_fund_nav_history` | `GET /api/funds/:code/nav-history` | query params are `startDate` / `endDate` |
| `get_fund_holdings` | `GET /api/funds/:code/holdings` | |
| `get_fund_managers` | `GET /api/funds/:code/managers` | |
| `get_market_indices` | `GET /api/market/indices` | |
| `get_index_kline` | `GET /api/market/kline/:symbol` | **A 股 `sh000300` / 海外 `DJI`（不带 `^`）**；`start_date` 与 `end_date` 必填 |
| `get_hot_sectors` | `GET /api/market/sectors?limit=` | raw envelope (`success` / `data` / `data_date` / `source`) |
| `get_concept_sectors` | `GET /api/market/concept-sectors?limit=` | raw envelope, flat `data` array → mapped |
| `get_north_flow` | `GET /api/market/north-flow` | **mapped** |
| `get_market_breadth` | `GET /api/market/breadth` | **mapped** |
| `get_main_flow` | `GET /api/market/money-flow` | **mapped** |
| `get_gold_realtime` | `GET /api/market/gold/realtime` | raw envelope |
| `get_flash_news` | `GET /api/news/flash?count=&page=1` | one tool for both frontend `get_market_news` / `get_flash_news` |

### Index symbols

`get_index_kline` accepts A-share symbols with an `sh` / `sz` prefix (`sh000300`, `sz399006`) and
overseas indices by bare code (`DJI`, `SPX`, `NDX`, `HSI`, `N225`, `FTSE`, `GDAXI`, `FCHI`, `SENSEX`).
The service routes bare overseas codes to the Yahoo-backed global kline path — **`^DJI` is rejected**
with `INVALID_ARGUMENT: Invalid symbol`. Overseas rows also use `YYYYMMDD` dates without dashes, and
come from Yahoo (slower, needs the proxy configuration described in AGENTS.md).

### Why `get_fund_detail` summarizes its time series

The legacy detail route returns ~1 MB, and >99% of it is time series
(`rank_history` ~300 KB; the NAV / accumulated-NAV / return / ranking arrays ~150-170 KB each).
Left verbatim it blows the result cap and the model can only see `fund_code` / `fund_name` /
`fund_type` / `net_worth_trend`. So six fields (`net_worth_trend`, `accumulated_net_worth`,
`total_return_trend`, `rank_history`, `ranking_trend`, `ranking_percentage`) are replaced with a
`{ count, first, last }` summary (`total_return_trend` gets one line per series), and a
`_series_note` tells the model to use `get_fund_nav_history` for the full NAV series.
Result: ~7 KB instead of ~1 MB, and every other section stays readable.

### Why four more tools are mapped instead of passed through

`get_north_flow`, `get_market_breadth`, `get_concept_sectors`, `get_main_flow` re-shape the
response to prevent the model from misreading it:

- north flow: net inflow stopped being published on 2024-08-19 and is permanently `null`
  (not `0`); only `*_deal_amount_yi` (亿元 = 百万元 ÷ 100) is valid.
- breadth: `limit_up` / `limit_down` can be `null`; the payload is renamed to snake_case.
- concept sectors: the route returns a flat array, and `event_date` must not be read as the quote date.
- main flow: an empty `date` means unavailable.

These mappings are copied from `frontend/src/services/chatEngine/toolHandlers.ts`, which encodes
several data-source lessons recorded in `AGENTS.md` → "Known issues". **This is the one deliberate
duplication in this extension.** It disappears when the frontend AI layer is eventually removed;
until then, keep both in sync when a data source changes.

### Deliberately not ported

- `get_market_anomaly` — the frontend handler always returns `{ anomalies: [], indices }` (dead code).
- `get_watchlist` — the frontend handler only returns a "stored in the frontend" notice.
- `search_news` — needs the frontend `searchService` and its localStorage keys.
- Backtest, 4433 screening, industry classification, positions, saved strategy scripts — browser-only
  (Web Worker sandbox, IndexedDB).

### Possible additions (not implemented)

`get_global_indices` (`/api/market/global-indices`), `get_market_overview` (`/api/market/overview`),
`get_volume_7days` (`/api/market/volume/7days`), `get_screening_snapshot`
(`/api/funds/screening-snapshot` | `/api/screening/sync`), `get_service_logs` (`/api/logs/read`).

## Implementation notes

- Imports `Type` from `@earendil-works/pi-ai` and `defineTool` from
  `@earendil-works/pi-coding-agent` — both are **host-provided** to extensions, so no
  `npm install` is needed. Do not add them to a `dependencies` block
  (see pi `docs/packages.md`: a physical copy bypasses pi's module mapping).
- Relative imports use explicit `.ts` extensions (pi loads extensions through jiti).
- Tool results are capped at 30 000 characters (custom tools get no automatic truncation
  like MCP's 20 KB); the truncation note tells the model to narrow the query.
- Rate limit: the service allows 300 requests / 15 min. A chatty session can hit it; the
  tool surfaces the HTTP 429 text instead of retrying.
