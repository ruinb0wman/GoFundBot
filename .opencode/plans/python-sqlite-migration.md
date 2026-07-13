# Python 精简 + SQLite 移除执行计划

> 创建: 2026-07-13 | 状态: 待执行
> 关联: AGENTS.md

## 检查点系统

每个 Phase 完成后标注 `[x] CP-N` 状态。中断后从最后一个未完成的 Phase 恢复。

| Phase | 检查点 | 状态 |
|-------|--------|------|
| 0: 分析确认 | CP-0 | ❌ |
| 1: 移除 SQLite 依赖 (Python 端) | CP-1 | ❌ |
| 2: 移除 SQLite 依赖 (Node.js 端) | CP-2 | ❌ |
| 3: 移除 SQLite 依赖 (前端 + 文档) | CP-3 | ❌ |
| 4: 迁移 search_web.py → TypeScript | CP-4 | ❌ |
| 5: 迁移 fetch_market.py → TypeScript | CP-5 | ❌ |
| 6: 迁移 fetch_volume.py → TypeScript | CP-6 | ❌ |
| 7: 清理 pythonRunner.ts 未使用的包装器 | CP-7 | ❌ |
| 8: 删除遗留 Python 服务 | CP-8 | ❌ |
| 9: 验证 + 修复 | CP-9 | ❌ |

---

## 检查点恢复文件

检查点状态写入 `.opencode/plans/python-sqlite-checkpoint.json`，Agent 中断后读取此文件自动恢复。

---

## 目标架构

```
之前: 132 个 Python 文件 + SQLite (funds.db)
之后: ~15 个 Python CLI 工具 (backtest, data_complete) + 0 SQLite

Python 仅作为 Node.js 调用的计算脚本:
  backtest.py       → 定投回测 + 策略推荐 (复杂金融计算)
  data_complete.py  → 通过 akshare 批量数据补全
  fetch_fund.py     → 基金数据拉取

其余全部: TypeScript 原生实现
  search             → searchService.ts  (新)
  market data        → marketService.ts + ProviderChain (已有)
  risk metrics       → riskMetricsService.ts (已有)
  industry           → industryService.ts (已有)
  AI analysis        → chatService.ts / aiAnalyst.ts (已有)
  all HTTP routes    → Express routes (已有)
```

---

## Phase 0: 分析确认

动作: 阅读本计划，确认迁移范围，决定从哪个 Phase 开始继续。

恢复点: `git checkout -b refactor/python-sqlite-cleanup` (建议先建分支)

---

## Phase 1: 移除 SQLite 依赖 — Python 端 (CP-1)

### 1a: 删除 Python SQLite 核心模块

```bash
rm -f Scripts/database.py
rm -f Scripts/models.py
rm -rf Scripts/migrate_db/
```

### 1b: 删除 SQLite 写入的服务模块

```bash
rm -f Scripts/services/estimate_service.py
rm -f Scripts/services/memory_log.py
rm -f Scripts/services/stock_industry.py
rm -f Scripts/services/risk_metrics.py
rm -f Scripts/services/stock_utils.py
```

### 1c: 删除 screening_engine (依赖 SQLite)

```bash
rm -rf Scripts/services/screening_engine/
```

### 1d: 删除 research 模块 (依赖 SQLite)

```bash
rm -f Scripts/services/research/__init__.py
rm -f Scripts/services/research/constants.py
rm -f Scripts/services/research/etf_tracking.py
rm -f Scripts/services/research/market_stats.py
rm -f Scripts/services/research/sector_summary.py
```

### 1e: 删除 fund_industry 模块 (依赖 SQLite)

```bash
rm -f Scripts/services/fund_industry/__init__.py
rm -f Scripts/services/fund_industry/exposure.py
rm -f Scripts/services/fund_industry/performance.py
rm -f Scripts/services/fund_industry/portfolio.py
rm -f Scripts/services/fund_industry/tagging.py
```

### 1f: 删除 SQLite 依赖的 CLI 脚本

```bash
rm -f Scripts/cli/compute_rankings.py
rm -f Scripts/cli/query_industry.py
rm -f Scripts/cli/compute_risk.py
rm -f Scripts/cli/classify_industry.py
```

### 验证

- 确认 `Scripts/` 下无 `from database import` / `from models import` 遗留
- 确认无 `sqlite3` / `SessionLocal` / `db.add` / `db.commit` 引用

---

## Phase 2: 移除 SQLite 依赖 — Node.js 端 (CP-2)

### 2a: 移除 system.routes.ts 中的 SQLite 检查

文件: `Service/src/routes/system.routes.ts`
- 移除第 25 行 `const dbPath = ...`
- 第 30 行移除 `sqlite: existsSync(dbPath) ? 'available' : 'unavailable',`

### 2b: 移除 package.json overrides

文件: `Service/package.json`
- 移除第 44 行 `"better-sqlite3@12.11.1": true`

### 验证

- `git grep -n sqlite Service/` 应返回 0
- `git grep -n 'better-sqlite3' Service/` 应返回 0

---

## Phase 3: 移除 SQLite 依赖 — 前端 + 文档 (CP-3)

### 3a: 删除 SettingsSqliteAdmin.vue

```bash
rm -f Frontend/src/views/SettingsSqliteAdmin.vue
```

### 3b: 更新路由

文件: `Frontend/src/router/index.ts`
- 移除 `import SettingsSqliteAdmin from '../views/SettingsSqliteAdmin.vue'`
- 移除 `{ path: 'sqlite-admin', ... }` 路由

### 3c: 移除导航项

文件: `Frontend/src/views/SettingsView.vue`
- 移除 `{ name: 'settings-sqlite-admin', icon: 'Database', label: ... }`

### 3d: 更新 AGENTS.md

- 第 79 行: 移除 `SQLite availability`

### 验证

- `git grep -n sqlite .` (排除 .venv, node_modules, .git, plan 文件) → 仅 plan 文件自身包含

---

## Phase 4: 迁移 search_web.py + search_service.py → TypeScript (CP-4)

### 4a: 创建 `Service/src/services/searchService.ts`

迁移策略: Bocha → Tavily → DuckDuckGo 降级链

```typescript
// searchService.ts — 替换 Python search_service.py + search_web.py
// API: Bocha (key), Tavily (key), DDG (无 key)
// Keys 来自 settingsService.getSearchSettings()
```

接口:

```typescript
export interface SearchResultItem {
  title: string;
  snippet: string;
  url: string;
  source: string;
  date: string | null;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResultItem[];
  provider: string;
  search_time: number;
  error?: string;
}

export async function searchWeb(
  query: string,
  maxResults?: number
): Promise<SearchResponse>;
```

Provider 顺序:
1. BochaSearchProvider → POST `https://api.bocha.cn/v1/web-search`
2. TavilySearchProvider → POST Tavily API
3. DuckDuckGoProvider → 使用 `https://api.duckduckgo.com` 或 npm `@microsoft/duckduckgojs`

### 4b: 更新 chatTools.ts

文件: `Service/src/services/chatTools.ts`
- 替换 `import { runPython } from './pythonRunner.js'` 为 `import { searchWeb } from './searchService.js'`
- 更新 `search_news` tool handler 直接调用 `searchWeb()`

### 4c: 删除 Python 文件

```bash
rm -f Scripts/cli/search_web.py
rm -f Scripts/search_service.py
```

### 验证

- `npm run typecheck` 通过
- 确认 `search_web` tool 可以搜索

---

## Phase 5: 迁移 fetch_market.py → TypeScript (CP-5)

### 5a: 分析 fetch_market.py 功能

`fetch_market.py` 通过 `--type` 参数提供:
| type | 数据来源 | TypeScript 现有状态 |
|------|----------|-------------------|
| index | akshare Sina | ✅ `eastmoneyMarketProvider.indices()` |
| sector | akshare THS | ✅ `eastmoneyMarketProvider.sectors()` |
| gold | 已返回 `[]` | ✅ `marketService.fetchGoldRealtime()` |
| concept-sector | akshare THS | ❌ 需要添加 |
| north-flow | akshare eastmoney | ❌ 需要添加 |
| breadth | akshare Sina | ❌ 需要添加 |
| main-flow | akshare eastmoney | ❌ 需要添加 |

### 5b: 在 eastmoneyMarketProvider 中添加缺失方法

添加: `conceptSectors()`, `northFlow()`, `marketBreadth()`, `mainFlow()`
全部通过 Direct EastMoney HTTP API 实现(不使用 akshare)。

### 5c: 更新 chatTools.ts

修改 `get_market_anomaly` tool handler 直接调用 marketService / ProviderChain。

### 5d: 更新 userData.routes.ts

替换 `runPython('fetch_market.py', ...)` 为 marketService 调用。

### 5e: 删除 Python 文件

```bash
rm -f Scripts/cli/fetch_market.py
```

### 验证

- 确认指数、板块、广度、北向资金端点可正常工作
- `git grep -n fetch_market Service/` 返回 0

---

## Phase 6: 迁移 fetch_volume.py → TypeScript (CP-6)

### 6a: 在 marketService.ts 中添加成交量数据获取

`fetch_volume.py` 通过 `fund_master_service` 获取 A 股 7 日成交量。
在 `marketService.ts` 中添加 `getVolumeData()` 函数，通过 EastMoney API 或 Sina Finance 获取。

### 6b: 更新 marketService.ts 调用点

替换 `Service/src/services/marketService.ts` 中第 664 行的 `runPython('fetch_volume.py')` 为原生 TS 实现。

### 6c: 删除 Python 文件

```bash
rm -f Scripts/cli/fetch_volume.py
```

### 验证

- `marketAPI.getVolumeWeekly()` 返回正常数据
- `git grep -n fetch_volume Service/` 返回 0

---

## Phase 7: 清理 pythonRunner.ts 未使用的包装器 (CP-7)

### 7a: 移除导出函数

从 `pythonRunner.ts` 移除:
- `runComputeRisk` (被 `riskMetricsService.ts` 替代)
- `runClassifyIndustry` (被 `industryService.ts` 替代)
- `runQueryIndustryFunds` (已迁移/废弃)
- `runIndustryPerformance` (已迁移/废弃)
- `runFetchMarket` (被 native TS 替代)

### 7b: 更新导入

- `Service/src/services/marketService.ts`: 移除 `import { runFetchMarket, runPython }`
- `Service/src/services/chatTools.ts`: 移除 `import { runBacktest, runFetchMarket, runPython }` → 只保留 `runBacktest`
- `Service/src/routes/backtest.routes.ts`: 保持 `runBacktest`
- `Service/src/routes/userData.routes.ts`: 移除 `import { runPython }` (替换为 marketService)

### 验证

- `npm run typecheck` 通过
- `npm run lint` 通过

---

## Phase 8: 删除遗留 Python 服务 (CP-8)

### 8a: 删除 AI 相关遗留代码

```bash
rm -f Scripts/ai_service.py
rm -rf Scripts/services/ai_agent/
rm -rf Scripts/services/fund_analysts/
```

### 8b: 删除遗留数据服务

```bash
rm -rf Scripts/services/market_data/
rm -f Scripts/services/data_service_client.py
rm -f Scripts/services/data_service_legacy_mapper.py
rm -f Scripts/services/market_alert.py
rm -f Scripts/services/industry_classification.py
```

### 8c: 删除遗留外部服务

```bash
rm -rf Scripts/market_data_service/
rm -rf Scripts/fund_master_service/
rm -rf Scripts/fund_api/
```

### 8d: 删除遗留基础设施

```bash
rm -rf Scripts/core/
rm -rf Scripts/schemas/
```

### 8e: 删除遗留根级文件

```bash
rm -f Scripts/config.py
rm -f Scripts/symbols.py
rm -f Scripts/stock_service.py
rm -f Scripts/fund_list_cache.py
```

### 8f: 删除继承的测试

```bash
rm -rf Scripts/tests/
```

### 8g: 删除无用的 tests 数据目录

确认 `Scripts/tests/` 被删除。保留 `Scripts/Data/` 日志目录用于日志记录。

---

## Phase 9: 验证 + 修复 (CP-9)

### 构建验证

```bash
cd Service && npm run typecheck && npm run lint && npm test
cd Frontend && npx vue-tsc --noEmit && npm run lint && npm test
```

### 清理 `pythonRunner.ts`

最终 `pythonRunner.ts` 只包含:
- `runPython()` — 通用执行器
- `runBacktest()` — 包装 `backtest.py`
- `runDataComplete()` — 包装 `data_complete.py` (可选)

### 确认保留的 Python 文件清单

```
Scripts/
├── cli/
│   ├── __init__.py
│   ├── _template.py
│   ├── backtest.py
│   ├── data_complete.py
│   ├── fetch_fund.py
│   ├── analyze_logs.py
│   ├── memory_reflect.py
│   ├── check_file_length.py
│   └── shared/
│       ├── __init__.py
│       └── http_client.py
├── providers/
│   ├── __init__.py
│   ├── eastmoney.py
│   └── tencent.py
├── services/
│   ├── __init__.py
│   ├── backtest.py          # 被 cli/backtest.py 调用
│   ├── backtest_strategies.py # 被 cli/backtest.py 调用
│   └── helpers.py           # 被 backtest.py 调用
├── Data/
│   └── logs/                # 保留日志目录
└── .venv/                   # 保留虚拟环境
```

总计: ~15 个 Python 文件
