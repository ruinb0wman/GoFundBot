# 迁移至 Express + IndexedDB 执行计划

> 创建: 2026-07-09 | 状态: 执行中
> 关联: AGENTS.md, 数据库丢失问题

## 检查点系统

每个 Phase 完成后标注 `[x] CP-N` 状态。中断后从最后一个未完成的 Phase 恢复。

| Phase | 检查点 | 状态 |
|-------|--------|------|
| 0: 依赖准备 (npm packages) | CP-0 | ✅ |
| 1: Python 脚本化 (8 scripts) | CP-1 | ✅ |
| 2: Express PythonRunner + 清理  | CP-2 | ✅ |
| 3a: Fund 路由桥接层 (singular → plural) | ✅ | ✅ |
| 3b: Screening 路由 (包装筛选查询) | ✅ | ✅ |
| 3c: Research 路由 (投研看板) | ✅ | ✅ |
| 3d: User-data 路由 (watchlist/portfolio/alert) | ✅ | ✅ |
| 3e: Backtest + System 路由 | ✅ | ✅ |
| 4: AI 分析迁 Node.js (openai npm) | CP-4 | ⏳ |
| 5: IndexedDB + Dexie 前端数据层 | CP-5 | ✅ |
| 6: Vite proxy 切到 Express:3100 + AGENTS.md 更新 | CP-6 | ✅ |
| 7: 端到端验证 | CP-7 | ✅ (基础) |

---

## 目标架构

```
Frontend (Vue 3)                Express (port 5000)              Python Scripts
┌──────────────────┐            ┌──────────────────────┐        ┌──────────────────┐
│ Dexie/IndexedDB  │◄───HTTP───│ Routes               │ spawn  │ scripts/         │
│  自选/持仓/交易   │            │  /api/fund/*         │───────►│  backtest.py     │
│  告警/聊天/缓存   │            │  /api/market/*       │        │  fetch_data.py   │
│ Pinia (实时状态)  │            │  /api/watchlist/*    │        │  compute_risk.py │
└──────────────────┘            │  /api/portfolio/*    │        │  classify.py     │
                                │  /api/alerts/*       │ read   │  ...             │
                                │  /api/chat/* (SSE)   │────────►──────────────────┐
                                │  /api/backtest/*     │        │  SQLite funds.db │
                                │  /api/research/*     │        │  (Python 写入)   │
                                │  /api/health         │        └──────────────────┘
                                │                      │
                                │ Services             │
                                │  AI Analyst (openai) │
                                │  ProviderChain (已有)│
                                │  MemoryCache (已有)  │
                                │  PythonRunner (新增) │
                                │  SQLiteReader (新增) │
                                │  better-sqlite3      │
                                └──────────────────────┘
```

**数据流**: `前端 → Express → [Python|SQLite|ProviderChain] → Express → 前端 → IndexedDB`

---

## Phase 0: 依赖准备 [检查点: CP-0]

**前置条件**: 无

### 任务

#### 0a — Service 新依赖
```bash
cd Service
npm i better-sqlite3 openai zod pino
npm i -D @types/better-sqlite3
```

#### 0b — Frontend 新依赖
```bash
cd Frontend
npm i dexie
```

#### 0c — Python requirements 精简
```bash
# 编辑 Scripts/requirements.txt，删除 Flask 生态包
```

### CP-0 验证
- [x] `cd Service && npm run typecheck && npm test` 通过
- [x] `cd Frontend && npx vue-tsc --noEmit && npm test` 通过
- [x] `pip install -r Scripts/requirements.txt` 成功

---

## Phase 1: Python 脚本化 [检查点: CP-1]

**前置条件**: CP-0

### 设计原则

所有脚本遵循统一契约：
```
stdin:  JSON (复杂参数) 或 CLI args
stdout: { success: true, data: {...} }  单行 JSON
stderr: 日志 (仅在 exit code ≠ 0 时 Express 读取)
退出码: 0=成功, 非0=失败
超时:   120s (回测), 30s (其他)
```

### 任务

#### 1a — 创建脚本骨架 `Scripts/cli/_template.py`
#### 1b — 创建 8 个脚本
| 脚本 | 来源 | 功能 |
|------|------|------|
| `backtest.py` | `services/backtest.py` + `backtest_strategies.py` | 定投回测 |
| `fetch_fund.py` | `fund_api/` + `providers/eastmoney.py` | 基金数据 → SQLite |
| `fetch_market.py` | `fund_master_service/` + `market_data_service/` | 市场数据 → SQLite |
| `compute_risk.py` | `services/risk_metrics.py` | 风险指标 |
| `compute_rankings.py` | `services/screening_engine/rankings.py` | 同类排名 |
| `classify_industry.py` | `services/industry_classification.py` | 行业分类 |
| `memory_reflect.py` | `services/memory_log.py` | 分析记忆反思 |
| `data_complete.py` | `providers/` + `symbols.py` | 数据补全 |
#### 1c — 创建 `Scripts/cli/shared/` 共享库

### CP-1 验证
- [ ] 所有脚本可独立运行
- [ ] stdout 为合法 JSON
- [ ] SQLite 数据正确写入

---

## Phase 2: Express PythonRunner + SQLiteReader [检查点: CP-2]

**前置条件**: CP-1

### 任务

#### 2a — `Service/src/services/pythonRunner.ts`
#### 2b — `Service/src/services/sqliteReader.ts`
#### 2c — 集成测试

### CP-2 验证
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 全部通过
- [ ] Express 调 Python 返回结果

---

## Phase 3: Express 路由扩展 [检查点: CP-3]

**前置条件**: CP-2

### 任务

| 新文件 | Flask 来源 |
|--------|-----------|
| `routes/watchlist.routes.ts` | `routes/watchlist_routes.py` |
| `routes/portfolio.routes.ts` | `routes/user_portfolio/*` |
| `routes/alert.routes.ts` | `routes/alert_routes.py` |
| `routes/chat.routes.ts` | `routes/chat_routes.py` |
| `routes/backtest.routes.ts` | `routes/backtest_routes.py` |
| `routes/research.routes.ts` | `routes/research_routes.py` |
| `routes/screening.routes.ts` | `routes/screening_routes/*` |
| `routes/system.routes.ts` | `routes/system_routes.py` |

### CP-3 验证
- [ ] 所有端点返回 `{ success: true, data: {...} }`
- [ ] 回测: Express → Python → 正确结果
- [ ] `npm test` 全部通过

---

## Phase 4: AI 分析迁 Node.js [检查点: CP-4]

**前置条件**: CP-3

### 任务

#### 4a — `Service/src/services/aiAnalyst.ts`
4 个分析师（performance/holding/manager/market）+ Supervisor + SSE streaming
#### 4b — `Service/src/prompts/` 共享 prompt 目录
#### 4c — 迁移 memory_log.py 的反思逻辑

### CP-4 验证
- [ ] SSE streaming 正常
- [ ] prompt 与 Python 原版一致
- [ ] `npm test` 通过

---

## Phase 5: IndexedDB + Dexie 前端数据层 [检查点: CP-5]

**前置条件**: CP-3

### 任务

#### 5a — `Frontend/src/db/index.ts` Dexie 表定义
#### 5b — `Frontend/src/composables/useDexieCache.ts` stale-while-revalidate
#### 5c — 适配现有 composables

### CP-5 验证
- [ ] 首次加载: API → Dexie → 渲染
- [ ] 二次加载: Dexie 缓存 → 立即渲染
- [ ] 断网: 缓存 + OfflineBanner
- [ ] `vue-tsc && npm test` 通过

---

## Phase 6: 前端 API 切换 + 删除 Flask [检查点: CP-6]

**前置条件**: CP-3 + CP-5

### 任务

#### 6a — Vite proxy → Service (port 3100)
#### 6b — 删除 Flask 代码 (保留 scripts/ 和依赖)
#### 6c — 更新启动流程 + CI/CD

### CP-6 验证
- [ ] 前端所有页面正常
- [ ] 离线缓存正常工作
- [ ] CI/CD 绿色

---

## Phase 7: 端到端验证 + 数据库恢复 [检查点: CP-7]

**前置条件**: CP-6

### 任务

#### 7a — Python 脚本全量同步
```bash
python Scripts/cli/fetch_fund.py --all
python Scripts/cli/compute_risk.py --all
python Scripts/cli/compute_rankings.py --all
python Scripts/cli/classify_industry.py --all
```
#### 7b — 功能验证 (11 项)
#### 7c — 性能验证

### CP-7 验证
- [ ] 全部 11 项功能检查通过
- [ ] 性能指标达标
- [ ] CI/CD pipeline 绿色

---

## 设计变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-07-09 | 移除 `better-sqlite3` 和 `sqliteReader.ts` | 零服务端数据库架构。Python 纯 stdin/stdout，Express 无状态，所有持久化在 IndexedDB。 |
| 2026-07-09 | Python 脚本移除 SQLite 写入 | 改为 stdin → stdout，不再写 `funds.db` |

## 风险矩阵

| 风险 | 概率 | 缓解 |
|------|------|------|
| Python 脚本大 JSON 序列化失败 | 中 | 分批处理，限制单批大小 |
| AI prompt 迁移语义漂移 | 低 | 共享 `shared_prompts/*.txt` |
| IndexedDB 存储配额超限 | 低 | TTL 清理策略 |
