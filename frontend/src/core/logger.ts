const LOG_LEVELS = ['info', 'warn', 'error'] as const
type LogLevel = (typeof LOG_LEVELS)[number]

interface LogEntry {
  level: LogLevel
  message: string
  time: string
  context?: Record<string, unknown>
}

const buffer: LogEntry[] = []
const MAX_BUFFER = 50
const FLUSH_INTERVAL = 5000

let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  if (buffer.length === 0) return
  const batch = buffer.splice(0, MAX_BUFFER)
  try {
    const payload = JSON.stringify({ entries: batch })
    navigator.sendBeacon('/api/logs/ingest', payload)
  } catch {
    // 静默失败
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_INTERVAL)
}

function enqueue(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    message,
    time: new Date().toISOString(),
    ...(context ? { context } : {}),
  }
  buffer.push(entry)
  if (buffer.length >= MAX_BUFFER) {
    flush()
  } else {
    scheduleFlush()
  }
}

export const clientLogger = {
  info(message: string, context?: Record<string, unknown>) {
    console.info(`[client] ${message}`, context ?? '')
    enqueue('info', message, context)
  },
  warn(message: string, context?: Record<string, unknown>) {
    console.warn(`[client] ${message}`, context ?? '')
    enqueue('warn', message, context)
  },
  error(message: string, context?: Record<string, unknown>) {
    console.error(`[client] ${message}`, context ?? '')
    enqueue('error', message, context)
  },
}

export function initClientLogger(): void {
  window.addEventListener('error', (event) => {
    clientLogger.error('Uncaught error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    clientLogger.error('Unhandled rejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  window.addEventListener('beforeunload', () => {
    flush()
  })
}
