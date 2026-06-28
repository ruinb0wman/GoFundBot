type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
  child: (baseContext: Record<string, unknown>) => Logger;
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? { context } : {}),
  };

  const line = JSON.stringify(payload);
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
