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
  const payload = JSON.stringify({ entries: batch })
  try {
    // A plain string makes sendBeacon send `text/plain`, which the service's
    // `express.json()` ignores (`/api/logs/ingest` then answers 400 and the
    // entries are lost). A JSON Blob keeps the Content-Type parseable.
    const blob = new Blob([payload], { type: 'application/json' })
    if (navigator.sendBeacon?.('/api/logs/ingest', blob)) return
  } catch {
    // fall through to fetch
  }
  try {
    void fetch('/api/logs/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // service unreachable / offline — drop the batch
    })
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
