# `@gofund/core` — 共享计算内核

GoFundBot 的**纯计算**层：前端与 Node service 用**同一份源码**，因此两边结果必然一致。

## 约束（重要）

- 允许的依赖：`decimal.js`。
- **禁止**引入 DOM / `fetch` / Dexie / Web Worker / Vue；取数由调用方注入
  （前端用 `frontend/src/services/backtest/dataBroker.ts`，service 用自己的数据层）。
- 相对 import 必须带 `.js` 后缀（Node ESM 要求；Vite 也能解析这种 TS 写法）。

## 内容

| 目录/文件 | 内容 |
|---|---|
| `src/backtest/backtestEngine.ts` | 单基金回测引擎（与 `python/cli/backtest.py` 逐值对齐） |
| `src/backtest/portfolioBacktest.ts` | 多资产组合引擎（权重/再平衡/注水/cash 腿/TWR） |
| `src/backtest/strategySandbox.ts` | 策略代码沙箱逻辑（`prepare`/`onDay` → plan/决策） |
| `src/backtest/{strategyRules,pyCompat,timelineSample,portfolioSample,strategyCompare,toolArgs,strategyTemplates,backtestTypes}.ts` | 规则、CPython 兼容（round/ISO 周）、抽样、对比、类型 |
| `src/number.ts` | 风险指标（`computeRiskMetricsLocal` 等；展示格式化在前端） |
| `src/industryClassifier.ts` | 基金行业/类型分类 |
| `src/researchComputation.ts` | 投研看板聚合 |

## 消费方式（都读源码，不构建 dist）

- **前端**：`frontend/vite.config.ts` 的 `resolve.alias` + `frontend/tsconfig.json` 的 `paths`
  （`@gofund/core/*` → `packages/core/src/*`）；`frontend/vitest.config.js` 里也有一份 alias。
- **service**：`service/tsconfig.json` 的 `paths`；运行时依赖 `tsx`（dev）解析路径别名。
  - 注意：service 的 `tsconfig.json` **没有设 `rootDir`**（否则跨目录源码会报 TS6059），
    因此 `tsc` 产物形如 `dist/service/src/...` 与 `dist/packages/core/src/...`，`start` 脚本已相应调整。
- 依赖：`decimal.js` 由两个消费方各自声明（service 与 packages/core 都装了）。

## 验证

- 前端：`cd frontend && bun run test`（含 golden fixtures 对照 Python 实现）
- service：`cd service && bun run test` —— `__tests__/services/core-golden.test.ts`
  在 **Node 运行时**重跑同一批 fixtures，保证两边同值。
