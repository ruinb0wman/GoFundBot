import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
  child: (baseContext: Record<string, unknown>) => Logger;
}

function getDefaultLogDir(): string {
  const cwd = process.cwd();
  const shared = join(cwd, '../Scripts/Data/logs');
  if (existsSync(dirname(shared))) {
    return shared;
  }
  return join(cwd, 'logs');
}

const LOG_DIR = process.env.LOG_DIR || getDefaultLogDir();
let currentLogDate = '';

function getLogFilePath(): string {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentLogDate) {
    currentLogDate = today;
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
  }
  return join(LOG_DIR, `dataservice-${today}.jsonl`);
}

function writeToFile(line: string): void {
  try {
    appendFileSync(getLogFilePath(), line + '\n', 'utf-8');
  } catch {
    // 文件写入失败不阻塞主流程
  }
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? { context } : {}),
  };

  const line = JSON.stringify(payload);
  writeToFile(line);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

function createLogger(baseContext?: Record<string, unknown>): Logger {
  const merge = (context?: Record<string, unknown>) =>
    baseContext ? { ...baseContext, ...context } : context;

  return {
    info: (message: string, context?: Record<string, unknown>) => write('info', message, merge(context)),
    warn: (message: string, context?: Record<string, unknown>) => write('warn', message, merge(context)),
    error: (message: string, context?: Record<string, unknown>) => write('error', message, merge(context)),
    child: (context: Record<string, unknown>) => createLogger(merge(context)),
  };
}

export const logger: Logger = createLogger();
