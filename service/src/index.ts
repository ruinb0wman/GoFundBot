import 'dotenv/config';
import { createServer, type Server } from 'node:http';
import { createApp } from './app.js';
import { logger } from './core/logger.js';

function validateEnv(): void {
  const issues: string[] = [];

  if (process.env.NODE_ENV === 'production') {
    const cors = process.env.CORS_ORIGINS?.trim();
    if (!cors || cors === '*') {
      issues.push('CORS_ORIGINS 未设置或为 * — 生产环境应限制来源');
    }
  }

  if (issues.length > 0) {
    for (const msg of issues) {
      logger.warn('配置问题', { issue: msg });
    }
  }
}

validateEnv();

const port = Number(process.env.PORT ?? 8310);

const app = createApp();
const server: Server = createServer(app);

server.listen(port, () => {
  logger.info('gofund data service started', {
    port,
    env: process.env.NODE_ENV ?? 'development',
  });
});

function gracefulShutdown(signal: string) {
  logger.info('收到关闭信号，开始优雅退出...', { signal });
  server.close(() => {
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
