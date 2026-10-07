/**
 * `@gofund/core` —— GoFundBot 的共享计算内核（纯 TS，无 DOM / 无框架 / 无 Dexie）。
 *
 * 允许的依赖：`decimal.js`。**不要**在这里引入前端 API（fetch/Dexie/Worker）或 service 代码；
 * 需要取数的部分由调用方注入（前端用 `services/backtest/dataBroker.ts`，service 用自己的数据层）。
 *
 * 消费方式：前端走 Vite alias + tsconfig paths，service 走 tsconfig paths，
 * 都直接读源码（不构建 dist）。
 */
export * from './number.js'

export * from './backtest/backtestTypes.js'
export * from './backtest/backtestEngine.js'
export * from './backtest/portfolioBacktest.js'
export * from './backtest/portfolioSample.js'
export * from './backtest/pyCompat.js'
export * from './backtest/strategyCompare.js'
export * from './backtest/strategyRules.js'
export * from './backtest/strategySandbox.js'
export * from './backtest/strategyTemplates.js'
export * from './backtest/timelineSample.js'
export * from './backtest/toolArgs.js'

export * from './industryClassifier.js'
export * from './screeningEnrich.js'
export * from './researchComputation.js'
