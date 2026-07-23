import { AppError } from './errors.js';
import type { ProviderChainResult, ProviderErrorSummary } from '../providers/types.js';
import type { DataSourceScorer } from './dataSourceScorer.js';

export interface NamedProvider {
  name: string;
}

export class ProviderChain<P extends NamedProvider> {
  constructor(
    private readonly providers: P[],
    private readonly scorer?: DataSourceScorer,
  ) {}

  async run<T>(
    operation: string,
    invoke: (provider: P) => Promise<T>,
    options?: { validate?: (data: T) => boolean; timeoutMs?: number }
  ): Promise<ProviderChainResult<T>> {
    const { validate, timeoutMs } = options ?? {};
    const providerErrors: ProviderErrorSummary[] = [];

    const orderedProviders = this.scorer
      ? this.scorer.sortByScore(this.providers, operation)
      : this.providers;

    for (const [index, provider] of orderedProviders.entries()) {
      try {
        const promise = invoke(provider);
        const data = timeoutMs != null
          ? await withTimeout(promise, timeoutMs, `${operation}@${provider.name}`)
          : await promise;
        if (validate && !validate(data)) {
          throw new Error(`Validation failed for ${provider.name}: data is empty or invalid`);
        }
        this.scorer?.recordSuccess(provider.name, operation);
        return {
          data,
          provider: provider.name,
          fallback: index > 0,
          stale: false,
          providerErrors,
        };
      } catch (error) {
        this.scorer?.recordFailure(provider.name, operation);
        providerErrors.push(summarizeProviderError(provider.name, error));
      }
    }

    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      `All providers failed for ${operation}`,
      503,
      { providerErrors }
    );
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const err: AppError = new AppError('PROVIDER_TIMEOUT', `${label} timed out after ${ms}ms`, 504);
          reject(err);
        }, ms);
      }),
    ]);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function summarizeProviderError(provider: string, error: unknown): ProviderErrorSummary {
  if (error instanceof Error) {
    const maybeCode = 'code' in error ? (error as { code?: unknown }).code : undefined;
    return {
      provider,
      message: error.message,
      code: maybeCode,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      provider,
      message: typeof record.message === 'string' ? record.message : JSON.stringify(record),
      code: record.code,
    };
  }

  return {
    provider,
    message: String(error),
  };
}
