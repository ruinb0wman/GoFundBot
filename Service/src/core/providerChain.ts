import { AppError } from './errors.js';
import type { ProviderChainResult, ProviderErrorSummary } from '../providers/types.js';

export interface NamedProvider {
  name: string;
}

export class ProviderChain<P extends NamedProvider> {
  constructor(private readonly providers: P[]) {}

  async run<T>(
    operation: string,
    invoke: (provider: P) => Promise<T>,
    validate?: (data: T) => boolean
  ): Promise<ProviderChainResult<T>> {
    const providerErrors: ProviderErrorSummary[] = [];

    for (const [index, provider] of this.providers.entries()) {
      try {
        const data = await invoke(provider);
        if (validate && !validate(data)) {
          throw new Error(`Validation failed for ${provider.name}: data is empty or invalid`);
        }
        return {
          data,
          provider: provider.name,
          fallback: index > 0,
          stale: false,
          providerErrors,
        };
      } catch (error) {
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
