import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LogEntry {
  level: string;
  message: string;
  time: string;
  context?: Record<string, unknown>;
  source?: string;
}

export interface ReadLogsOptions {
  level?: string;
  keyword?: string;
  limit: number;
  offset: number;
}

export interface ReadLogsResult {
  entries: LogEntry[];
  total: number;
  counts: Record<string, number>;
}

export interface LogAnalysis {
  total: number;
  error_count: number;
  warn_count: number;
  patterns: string[];
  suggestions: string[];
  critical: string[];
}

const DEFAULT_LOG_DIR = join(process.cwd(), '../python/Data/logs');

const SUGGESTION_RULES: Array<{ pattern: RegExp; suggestion: string }> = [
  { pattern: /timeout|timed out|abort/i, suggestion: '存在超时请求，建议增大超时时间或对慢数据源做降级' },
  { pattern: /fetch failed|econn|network|unavailable|refused/i, suggestion: '存在网络/数据源不可用错误，建议检查网络与代理配置' },
  { pattern: /rate.?_?limited|429/i, suggestion: '触发限流，建议降低请求频率或调整 express-rate-limit 阈值' },
  { pattern: /jsonparse|unexpected token|invalid.*json/i, suggestion: '存在解析失败，建议对第三方响应增加容错与重试' },
  { pattern: /undefined|is not a function|typeerror/i, suggestion: '存在代码缺陷，建议补充空值判断并修复类型错误' },
  { pattern: /zod|validation|invalid argument/i, suggestion: '存在入参校验失败，建议前端修正请求参数格式' },
];

const CRITICAL_PATTERNS: RegExp[] = [
  /uncaught error|unhandled rejection|fatal|crash|out of memory|oom/i,
];

function getLogDir(): string {
  return process.env.LOG_DIR || DEFAULT_LOG_DIR;
}

function logFilePath(source: string, date: string): string {
  return join(getLogDir(), `${source}-${date}.jsonl`);
}

function ensureLogDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function parseEntries(source: string, date: string): LogEntry[] {
  const filePath = logFilePath(source, date);
  if (!existsSync(filePath)) {
    return [];
  }
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as LogEntry;
      if (entry && typeof entry === 'object') {
        entry.level = String(entry.level ?? 'info').toLowerCase();
        entries.push(entry);
      }
    } catch {
      // 跳过无法解析的行
    }
  }
  return entries;
}

export function readLogs(source: string, date: string, options: ReadLogsOptions): ReadLogsResult {
  const { level, keyword, limit, offset } = options;
  const lowerKeyword = keyword?.toLowerCase();

  const filtered = parseEntries(source, date).filter((entry) => {
    if (level && entry.level !== level) return false;
    if (lowerKeyword) {
      const text = JSON.stringify(entry).toLowerCase();
      if (!text.includes(lowerKeyword)) return false;
    }
    return true;
  });

  const counts: Record<string, number> = {};
  for (const entry of filtered) {
    counts[entry.level] = (counts[entry.level] ?? 0) + 1;
  }

  return {
    entries: filtered.slice(offset, offset + limit),
    total: filtered.length,
    counts,
  };
}

export function existsLogFile(source: string, date: string): boolean {
  return existsSync(logFilePath(source, date));
}

export function appendEntry(source: string, entry: Omit<LogEntry, 'source'>): void {
  const dir = getLogDir();
  ensureLogDir(dir);
  const today = new Date().toISOString().slice(0, 10);
  const line = JSON.stringify({ ...entry, source }) + '\n';
  appendFileSync(logFilePath(source, today), line, 'utf-8');
}

export function analyzeLogs(source: string, date: string): LogAnalysis {
  const entries = parseEntries(source, date);

  const errors = entries.filter((e) => e.level === 'error');
  const warnings = entries.filter((e) => e.level === 'warn');

  const clusters = new Map<string, { count: number; sample: string }>();
  for (const entry of errors) {
    const key = entry.message.slice(0, 60);
    const existing = clusters.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      clusters.set(key, { count: 1, sample: entry.message });
    }
  }

  const patterns = [...clusters.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([key, info]) => `「${key}」出现 ${info.count} 次`);

  const text = [...errors, ...warnings].map((e) => e.message).join('\n');
  const suggestions = SUGGESTION_RULES.filter((rule) => rule.pattern.test(text)).map(
    (rule) => rule.suggestion,
  );

  const critical = errors
    .filter((e) => CRITICAL_PATTERNS.some((re) => re.test(e.message)))
    .map((e) => e.message)
    .slice(0, 5);

  return {
    total: entries.length,
    error_count: errors.length,
    warn_count: warnings.length,
    patterns,
    suggestions,
    critical,
  };
}
