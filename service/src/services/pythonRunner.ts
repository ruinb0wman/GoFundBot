import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../core/logger.js';

export interface PythonScriptResult<T = unknown> {
  success: true;
  data: T;
}

interface PythonScriptError {
  success: false;
  error: string;
}

type PythonOutput<T> = PythonScriptResult<T> | PythonScriptError;

interface RunOptions {
  args?: string[];
  input?: Record<string, unknown>;
  timeoutMs?: number;
  retries?: number;
}

const DEFAULT_SCRIPT_DIR = join(import.meta.dirname, '../../../python/cli');
const SCRIPT_DIR = process.env.PYTHON_SCRIPTS_DIR ?? DEFAULT_SCRIPT_DIR;
const DEFAULT_PYTHON_BIN = join(import.meta.dirname, '../../../python/.venv/bin/python');
const PYTHON_BIN = process.env.PYTHON_BIN ?? (existsSync(DEFAULT_PYTHON_BIN) ? DEFAULT_PYTHON_BIN : 'python3');
const DEFAULT_TIMEOUT_BACKTEST = 120_000;
const DEFAULT_TIMEOUT = 30_000;

export async function runPython<T = unknown>(
  script: string,
  options: RunOptions = {},
): Promise<T> {
  const { args = [], input, timeoutMs = DEFAULT_TIMEOUT, retries = 2 } = options;
  const scriptPath = join(SCRIPT_DIR, script);

  async function spawnOnce(): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const childArgs = args.length > 0 ? [scriptPath, ...args] : [scriptPath];
      const child = spawn(PYTHON_BIN, childArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      });

      let stdout = '';
      let stderr = '';

      if (input) {
        child.stdin.write(JSON.stringify(input));
        child.stdin.end();
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err: Error) => {
        logger.error('Python process spawn failed', {
          script,
          args,
          error: err.message,
        });
        reject(new Error(`Python spawn failed: ${err.message}`));
      });

      child.on('close', (code: number | null) => {
        if (code !== 0) {
          const errMsg = stderr.trim() || `Python exited with code ${code}`;
          logger.error('Python script failed', {
            script,
            code,
            stderr: stderr.trim(),
          });
          reject(new Error(errMsg));
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(undefined as unknown as T);
          return;
        }

        try {
          const parsed: PythonOutput<T> = JSON.parse(trimmed);
          if (!parsed.success) {
            reject(new Error(parsed.error ?? 'Unknown Python error'));
            return;
          }
          resolve(parsed.data as T);
        } catch {
          resolve(trimmed as unknown as T);
        }
      });
    });
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await spawnOnce();
    } catch (error) {
      if (attempt === retries) throw error;
      const msg = String(error).toLowerCase();
      const isRetryable = /timeout|econn|eaddrinuse|enotfound|spawn|reset/i.test(msg);
      if (!isRetryable) throw error;
      logger.warn(`Python retry ${attempt + 1}/${retries}`, { script, error: String(error) });
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }

  throw new Error('unreachable');
}

export async function runBacktest<T = unknown>(
  input: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_BACKTEST,
): Promise<T> {
  return runPython<T>('backtest.py', {
    input,
    timeoutMs,
  });
}
