# 4. 测试体系 — 执行计划

> 基线状态：Backend 仅 1 个测试文件 (5 条 `_build_portfolio_industry_tag` 用例)，DataService/Frontend 零测试  
> 目标：每层覆盖核心路径，中断可恢复  
> 测试框架：Backend = `unittest` (已用)；DataService = Vitest；Frontend = Vitest + @vue/test-utils

---

## 阶段检查清单 (Checkpoint Map)

```
Phase 0  [🔲] 基础设施准备
Phase 1  [🔲] Backend 单元测试扩展
Phase 2A [🔲] DataService 核心层测试
Phase 2B [🔲] DataService 路由/Provider 测试
Phase 3A [🔲] Frontend Stores + Composables 测试
Phase 3B [🔲] Frontend 关键组件测试
Phase 4  [🔲] 集成/契约测试
Phase 5  [🔲] 收尾：覆盖率报告 + 文档
```

恢复时看最后一个完成的 Phase，从下一个 CHECKPOINT 起始。

---

## Phase 0 — 基础设施准备

### 0.1 安装依赖

```bash
# DataService
cd DataService && npm install --save-dev vitest

# Frontend
cd Frontend && npm install --save-dev vitest @vue/test-utils jsdom
```

### 0.2 配置文件

- `DataService/vitest.config.ts` — 指向 `src/`，ts 路径别名
- `Frontend/vitest.config.js` — jsdom 环境，`@` → `src/` 别名
- `Frontend/src/__tests__/setup.js` — 全局 mock（router、echarts、axios）
- `Backend/tests/__init__.py` — 空文件确保包导入（若缺失）

### 0.3 package.json scripts 补充

- DataService: `"test": "vitest run"`, `"test:watch": "vitest"`
- Frontend: `"test": "vitest run"`, `"test:watch": "vitest"`

### CHECKPOINT-0 ✅

```
cd DataService && npx vitest --version
cd Frontend && npx vitest --version
python -c "import unittest; print('ok')"
```
三条命令均无报错即通过。

---

## Phase 1 — Backend 单元测试扩展

> 在现有 `unittest` 基础上扩建，不改框架。每个子任务完成后可独立运行验证。

### 1.1 `Backend/tests/test_schemas.py` (P0)
覆盖 schemas/ 下所有 Pydantic 模型的正向/负向校验：
- `watchlist_schemas.py`: `AddWatchlistSchema`, `BatchDeleteSchema`, `ReorderSchema`, `MoveFundSchema`, `CreateGroupSchema`
- `screening_schemas.py`: `ScreeningQuerySchema` 等

用例数预估：~12

### 1.2 `Backend/tests/test_cache_headers.py` (P1)
覆盖 `core/cache_headers.py`：
- GET 请求命中各路径前缀返回正确 `Cache-Control`
- POST 请求不设置缓存头
- 未匹配路径不设置头

用例数预估：~8

### 1.3 `Backend/tests/test_data_service_client.py` (P1)
覆盖 `services/data_service_client.py`：
- 各 DataService URL 拼接正确
- 超时/连接失败 → 正确异常类型
- `get_fund_detail` / `get_fund_nav_history` 等参数透传

用例数预估：~10

### 1.4 `Backend/tests/test_watchlist_db.py` (P0)
覆盖 `routes/watchlist_routes.py` 中的 DB 操作（需要 `setUp` 建临时 SQLite）：
- 添加/删除/分页查询自选
- 分组 CRUD
- `BatchDeleteSchema` 边界（空列表、超 100 条）

用例数预估：~10

### 1.5 `Backend/tests/test_screening_engine.py` (P1)
覆盖 `services/screening_engine.py` 核心筛选逻辑（mock DataService client）：
- 单一类型筛选 → 返回正确字段
- 分页参数透传
- 无结果处理

用例数预估：~6

### 1.6 `Backend/tests/test_fund_industry_classification.py` (补充)
现有 5 条测试，补充：
- ETF 联接无持仓 → 名称主题识别
- 全部美股持仓 → market_region 识别
- 港股持仓判定
- 边界：空 portfolio `{}`、`None` 输入
- QDII 日股/德股 topic 识别

用例数预估：~8 (总计 13)

### CHECKPOINT-1 ✅

```bash
python -m unittest discover -s Backend/tests -v
```

预期：≥50 条用例全部通过，无 ERROR/FAIL。

---

## Phase 2A — DataService 核心层测试

### 2A.1 `DataService/src/__tests__/core/cache.test.ts`
覆盖 `core/cache.ts`：
- `set` + `get` 命中/过期
- `cacheThrough` 加载器调用次数（只调 1 次）
- LRU 淘汰：写入超 `maxEntries` 后旧条目被移除
- `clear()` / `getCacheStats()`
- 各 TTL 常量非零

用例数预估：~10

### 2A.2 `DataService/src/__tests__/core/errors.test.ts`
覆盖 `core/errors.ts`：
- `AppError` 构造 + 属性
- `assertCode` 合法/非法输入
- `assertNumberRange` 边界
- `assertDate` 合法/非法
- `toAppError` 映射（timeout → 504, network → 503, generic → 502）
- `asyncHandler` 包裹的 handler 异常被 `next` 捕获

用例数预估：~12

### 2A.3 `DataService/src/__tests__/core/response.test.ts`
覆盖 `core/response.ts`（sendSuccess / sendFailure）：
- 200 成功 JSON 结构
- 4xx/5xx 错误 JSON 结构
- 自定义 status code

用例数预估：~6

### CHECKPOINT-2A ✅

```bash
cd DataService && npx vitest run src/__tests__/core/
```

预期：~28 用例全绿。

---

## Phase 2B — DataService 路由/Provider 测试

### 2B.1 `DataService/src/__tests__/routes/health.test.ts`
- `GET /api/health` → 200 + cache stats
- `GET /api/health/ready` → 200

用例数预估：~3

### 2B.2 `DataService/src/__tests__/routes/fund.test.ts`
Mock ProviderChain，测试：
- `GET /api/fund/:code` → 200 + 完整字段
- `GET /api/fund/:code/nav-history` 带日期参数
- 无效 code → 400
- Provider 不可用 → 503

用例数预估：~8

### 2B.3 `DataService/src/__tests__/providers/provider-chain.test.ts`
覆盖 `providers/ProviderChain.ts`：
- 第一 provider 成功 → 不调第二
- 第一失败 → fallback 到第二
- 全部失败 → 返回特定错误
- `eastmoneyFundProvider.performance()` 字段解析

用例数预估：~8

### CHECKPOINT-2B ✅

```bash
cd DataService && npx vitest run
```

预期：~47 用例全绿。

---

## Phase 3A — Frontend Stores + Composables 测试

### 3A.1 `Frontend/src/__tests__/stores/fundStore.test.js`
Mock API 层，测试：
- `fetchFundDetail(code)` → state 更新
- `fetchFundSearch(query)` → 结果列表
- 加载/错误状态切换

用例数预估：~8

### 3A.2 `Frontend/src/__tests__/stores/watchlistStore.test.js`
- `fetchWatchlist()` → 分组+列表
- `addToWatchlist(code)` → optimistic update
- `removeFromWatchlist(code)` → 移除
- `reorder()` → 排序变更

用例数预估：~8

### 3A.3 `Frontend/src/__tests__/stores/marketStore.test.js`
- `fetchMarketOverview()` → indices 数据
- 轮询逻辑（mock timer）

用例数预估：~5

### 3A.4 `Frontend/src/__tests__/composables/useTheme.test.js`
- `toggleTheme` 循环切换 light/dark/auto
- `localStorage` 读写
- `matchMedia` change 事件响应

用例数预估：~6

### 3A.5 `Frontend/src/__tests__/composables/useDebouncedWatch.test.js`
- 300ms 内多次变更只触发一次 callback
- flush 时机检验

用例数预估：~4

### CHECKPOINT-3A ✅

```bash
cd Frontend && npx vitest run src/__tests__/stores/ src/__tests__/composables/
```

预期：~31 用例全绿。

---

## Phase 3B — Frontend 关键组件测试

### 3B.1 `Frontend/src/__tests__/components/SkeletonChart.test.js`
- 渲染 `height`/`width` props
- SVG path 存在

用例数预估：~3

### 3B.2 `Frontend/src/__tests__/components/FundSearch.test.js`
Mock API + router：
- 输入基金代码 → emit `navigate-to-fund`
- 搜索列表渲染
- 空结果提示

用例数预估：~6

### 3B.3 `Frontend/src/__tests__/components/FundWatchlist.test.js`
Mock store：
- 自选列表渲染（分组显示）
- 拖拽排序触发 `reorder`
- 删除确认

用例数预估：~6

### CHECKPOINT-3B ✅

```bash
cd Frontend && npx vitest run
```

预期：~46 用例全绿。

---

## Phase 4 — 集成/契约测试

> 测试 Backend ↔ DataService 之间的关键 API 契约。

### 4.1 `Backend/tests/test_contract_fund_detail.py`
启动 Backend (Flask test client) + mock DataService 响应：
- `/api/fund/<code>` → 返回结构与 schema 一致
- DataService 返回 null 字段 → Backend 正确 fallback
- DataService 超时 → Backend 返回 504

用例数预估：~8

### 4.2 `Backend/tests/test_contract_watchlist.py`
- 完整 CRUD 流程（添加→查询→删除→查询空）
- 分页：page=2 page_size=5 → 正确 offset
- 批量删除边界

用例数预估：~6

### 4.3 `Backend/tests/test_contract_screening.py`
- `/api/screening/funds` POST 请求 → 正确参数透传
- 空结果 → 200 + items=[]

用例数预估：~4

### CHECKPOINT-4 ✅

```bash
python -m unittest discover -s Backend/tests -v
```

预期：~68 用例全绿。

---

## Phase 5 — 收尾

### 5.1 覆盖率配置

- Backend: `pip install coverage && coverage run -m unittest discover -s Backend/tests`
- DataService: vitest 内置覆盖率（`--coverage`，需 `@vitest/coverage-v8`）
- Frontend: 同上

### 5.2 更新 AGENTS.md

在 Testing 小节填入：
- 各层测试命令
- 覆盖率目标（建议 Backend ≥40%, DataService ≥50%, Frontend ≥30% 起步）

### 5.3 更新优化清单

标记 Section 4 各子项为完成状态。

### CHECKPOINT-5 ✅

```bash
# Backend
cd Backend && coverage run -m unittest discover -s tests -v && coverage report --omit="tests/*"
# DataService
cd DataService && npx vitest run --coverage
# Frontend
cd Frontend && npx vitest run --coverage
```

---

## 恢复指南

| 中断位置 | 恢复方式 |
|----------|----------|
| Phase 0 中途 | 重新跑 0.1 三条安装命令（幂等），继续到 CHECKPOINT-0 |
| Phase 1 中途 | 已完成子任务的文件不受影响；继续下一个 1.x |
| Phase 2A/2B | DataService 测试互不依赖；从 CHECKPOINT-2A/2B 的上一个 CHECKPOINT 起始 |
| Phase 3A/3B | 同理；从上一个通过的 CHECKPOINT 继续 |
| Phase 4 | 先确认 Phase 1 全绿，再逐一跑 4.1/4.2/4.3 |
| Phase 5 | 只依赖以上所有测试存在 |

核心原则：**每个子任务一个文件，文件写完立即可运行验证，不依赖全局状态。**

---

## 用例总数预估

| 层级 | 文件数 | 用例数 |
|------|--------|--------|
| Backend 单元 | 6 | ~54 |
| DataService 核心 | 3 | ~28 |
| DataService 路由/Provider | 3 | ~19 |
| Frontend Stores/Composables | 5 | ~31 |
| Frontend 组件 | 3 | ~15 |
| 集成/契约 | 3 | ~18 |
| **总计** | **23** | **~165** |

当前基线：1 文件，5 用例。
