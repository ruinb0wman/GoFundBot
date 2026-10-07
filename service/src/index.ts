import 'dotenv/config';
import { createServer, type Server } from 'node:http';
import { createApp } from './app.js';
import { logger } from './core/logger.js';
import { closeDb } from './db/index.js';

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
