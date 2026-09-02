# 数据流向

## 标准请求-响应流

```
用户操作 → Vue Component
  → Composable / API Client
    → axios (GET/POST /api/xxx)
      → Vite Proxy (开发) / Express static (生产)
        → Route Handler (asyncHandler)
          → service Function
            → cacheThrough(cacheKey, TTL, loader)
              ├── 缓存命中 → 直接返回 CacheLookup { cached: true }
              └── 缓存未命中 → ProviderChain.run(operation, invoke)
                    → stock-sdk (主) 成功? → MemoryCache.set() → 返回
                    → stock-sdk 失败? → eastmoney (备) → MemoryCache.set() → 返回
                    → 全部失败? → AppError(503)
          ← ServiceResult<T> { data, provider, fallback, cached, stale, updatedAt }
        ← sendSuccess(res, data)
      ← JSON Response
    ← 前端处理 → Dexie 缓存 (可选)
  ← 响应式更新 DOM
```

## 同步-异步混合流（基金详情）

`GET /api/funds/:code/detail` 是系统的核心端点，使用 `Promise.allSettled` 并行拉取 16 个数据段：

```typescript
// fundService.ts:302
const sectionNames = [
  'basic', 'estimate', 'navHistory', 'rankHistory', 'dividends',
  'holdings', 'assetAllocation', 'managers', 'performance',
  'performanceEvaluation', 'subscriptionRedemption', 'holderStructure',
  'sameTypeFunds', 'scaleFluctuation', 'positionTrend', 'totalReturnTrend',
];

// 并行请求，每个 section 独立超时（12s）
const results = await Promise.allSettled(
  sectionNames.map(section => withTimeout(loadSection(section), 12000, `fund.${section}`))
);

// 响应返回后，后台异步补足缓存数据
setImmediate(() => enrichFund(fundCode));
```

**核心设计原则**：
- 每个 section 独立失败，失败不阻塞整体
- 失败 section 以 `{ data: null, error: { code, message } }` 占位
- `failedSections: string[]` 返回给前端，前端可针对性重新请求
- 后台 `enrichFund` 通过 `setImmediate` 延迟执行，不增加响应时间

## Python 脚本调用流

```
service (Node.js)
  → pythonRunner.runPython(scriptName, input)
    → child_process.spawn(pythonBin, [scriptPath])
      → stdin.write(JSON.stringify(input))
      → stdin.end()
      → stdout.on('data') → accumulate buffer
      → close event → JSON.parse(buffer)
        → 成功 → 返回 { success: true, data: ... }
        → 失败 → 返回 { success: false, error: ... }
      → 超时 (120s) → process.kill('SIGTERM')
        → 10s 后未退出 → process.kill('SIGKILL')
```

## 前端持久化流

```
API 响应 → Dexie.js (IndexedDB)
  ├── fundCache: fundCode → { data, updatedAt }
  ├── marketCache: key → { data, updatedAt }
  ├── screeningFunds: fund_code → 筛选数据
  ├── analysisMemory: fundCode → 历史分析记录
  └── 用户数据（纯前端 CRUD，不经过服务端）:
      ├── watchlist → watchlistGroups
      ├── portfolio → tradeRecords → positions
      ├── alertRules
      └── chatSessions → chatMessages
```

> **关键约束**：所有用户数据全部存储在浏览器 IndexedDB，Express 服务端无状态、无用户数据库，部署简单。
