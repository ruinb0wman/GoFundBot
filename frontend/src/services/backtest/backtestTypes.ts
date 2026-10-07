/**
 * 兼容性转出。
 *
 * 回测类型与引擎已移到 `@gofund/core`（service 与前端共用同一份计算）。
 * 保留这个文件路径，是为了让既有 `./backtestTypes` 引用无需逐个改动。
 */
export * from '@gofund/core/backtest/backtestTypes'
