import 'dotenv/config';
import { createServer, type Server } from 'node:http';
import { logger } from './core/logger.js';

/**
 * 启动自检：`node:sqlite` 是硬依赖（用户数据/缓存的唯一真源）。
 * Node < 22.13（含 22.5~22.12 未加 `--experimental-sqlite`）上这个内置模块不存在，
 * 静态 import 会直接抛栈；这里先探一次，给出人话再退出。
 */
async function assertSqliteAvailable(): Promise<void> {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    new DatabaseSync(':memory:').close();
  } catch (error) {
    logger.error(
      '当前 Node 没有内置 SQLite（node:sqlite）。请升级到 Node >= 22.13（本仓库 engines 要求 >= 22.19）后重试。',
      { node: process.version, error: error instanceof Error ? error.message : String(error) },
    );
    process.exit(1);
  }
}

await assertSqliteAvailable();

const { createApp } = await import('./app.js');
const { closeDb } = await import('./db/index.js');

const port = Number(process.env.PORT ?? 8310);
/**
 * 默认只监听本机。service 承载用户数据与（后续）LLM 密钥，不应暴露到局域网；
 * 需要其它设备访问时显式设 HOST=0.0.0.0。
 */
const host = process.env.HOST ?? '127.0.0.1';

const app = createApp();
const server: Server = createServer(app);

server.listen(port, host, () => {
  logger.info('gofund data service started', {
    port,
    host,
    env: process.env.NODE_ENV ?? 'development',
  });
});

function gracefulShutdown(signal: string) {
  logger.info('收到关闭信号，开始优雅退出...', { signal });
  server.close(() => {
    closeDb();
    logger.info('HTTP 服务已关闭');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('优雅关闭超时，强制退出');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
