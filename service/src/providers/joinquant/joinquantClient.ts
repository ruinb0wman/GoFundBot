import { AppError } from '../../core/errors.js';
import { fetchUrl } from '../../core/fetch.js';
import { getSettings } from '../../services/settingsService.js';

const JOINQUANT_DATA_API = 'https://dataapi.joinquant.com/rest/data/';

let _token: string | null = null;
let _tokenExpiresAt = 0;

function getJoinquantKey(): string {
  const settings = getSettings() as unknown as Record<string, unknown>;
  const joinquant = settings.joinquant as Record<string, string> | undefined;
  return joinquant?.apiKey || process.env.JOINQUANT_API_KEY || '';
}

async function getToken(): Promise<string> {
  const now = Date.now();
  if (_token && _tokenExpiresAt > now) return _token;

  const apiKey = getJoinquantKey();
  if (!apiKey) {
    throw new AppError('PROVIDER_UNAVAILABLE', 'JoinQuant API key not configured', 502);
  }

  const [mob, pwd] = apiKey.split(':');
  if (!mob || !pwd) {
    throw new AppError('PROVIDER_UNAVAILABLE', 'JoinQuant API key must be in phone:password format', 502);
  }

  try {
    const token = await fetchUrl<string>(JOINQUANT_DATA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'get_token', mob, pwd }),
      timeoutMs: 10000,
    });
    _token = token.trim();
    _tokenExpiresAt = now + 3600_000;
    return _token;
  } catch (err) {
    _token = null;
    throw err instanceof AppError ? err : new AppError('PROVIDER_UNAVAILABLE', 'JoinQuant auth failed', 502);
  }
}

export interface JqQueryParams {
  table: string;
  columns?: string[];
  filter?: string;
  orderBy?: string;
  limit?: number;
  startDate?: string;
  endDate?: string;
  code?: string;
}

export async function jqQuery<T = Record<string, unknown>>(params: JqQueryParams): Promise<T[]> {
  const token = await getToken();
  const body: Record<string, unknown> = {
    token,
    method: 'run_query',
    table: params.table,
    columns: params.columns?.join(',') ?? '',
    filter: params.filter ?? '',
    order_by: params.orderBy ?? '',
    limit: params.limit ?? 5000,
  };

  if (params.startDate) body.date = params.startDate.replaceAll('-', '');
  if (params.endDate) body.end_date = params.endDate.replaceAll('-', '');

  const text = await fetchUrl<string>(JOINQUANT_DATA_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 15000,
  });

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const data = parsed.data ?? parsed;
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

export function hasJoinquantKey(): boolean {
  return !!getJoinquantKey();
}
