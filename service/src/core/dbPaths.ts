import { join } from 'node:path';

/**
 * service/ 目录。src/core 与 dist/core 两种布局下都上溯到同一处。
 * 与 logPaths.ts 同理：用 import.meta.dirname 而非 process.cwd()，
 * 否则从别的目录启动服务时数据库会落到仓库之外。
 */
const SERVICE_ROOT = join(import.meta.dirname, '../..');

/**
 * SQLite 数据库文件位置 —— 唯一来源。
 *
 * 默认落在 service/data/gofund.db（已 gitignore）；测试用 GOFUND_DB_PATH=':memory:' 覆盖。
 * 该库承载用户数据（策略/持仓/自选/方案）、设置（含 LLM 密钥）与缓存。
 */
export function resolveDbPath(): string {
  return process.env.GOFUND_DB_PATH || join(SERVICE_ROOT, 'data/gofund.db');
}
