import { join } from 'node:path';

/**
 * service/ 目录。src/core 与 dist/core 两种布局下都上溯到同一处。
 * 用 import.meta.dirname（Node ≥20.11，pythonRunner.ts 已依赖该能力）而非 process.cwd()，
 * 否则从别的目录启动服务时日志会落到仓库之外。
 */
const SERVICE_ROOT = join(import.meta.dirname, '../..');

/**
 * 日志目录 —— 读（logService）/ 写（logger）两侧的唯一来源，两者必须一致，
 * 否则日志写进去了但 Logs 页面与 AI 日志分析读不到。
 *
 * 默认落在仓库根的 python/Data/logs；环境变量 LOG_DIR 可覆盖（测试用）。
 */
export function resolveLogDir(): string {
  return process.env.LOG_DIR || join(SERVICE_ROOT, '../python/Data/logs');
}
