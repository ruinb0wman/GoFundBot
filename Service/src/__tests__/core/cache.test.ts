import { describe, it, expect, vi } from 'vitest';

// For tests needing custom maxEntries, set env before module loads
const CACHE_WITH_LIMIT = vi.hoisted(() => {
  process.env.CACHE_MAX_ENTRIES = '10';
  return true;
});

describe('MemoryCache', () => {
  it('stores and retrieves a value', async () => {
    const { cache } = await import('../../core/cache.js');
    cache.clear();
    const result = cache.set('key1', { foo: 'bar' }, 60_000);
    expect(result.cached).toBe(false);
    const lookup = cache.get<{ foo: string }>('key1');
    expect(lookup).not.toBeNull();
    expect(lookup!.value).toEqual({ foo: 'bar' });
    expect(lookup!.cached).toBe(true);
  });

  it('returns null for missing key', async () => {
    const { cache } = await import('../../core/cache.js');
    cache.clear();
    const lookup = cache.get('nonexistent');
    expect(lookup).toBeNull();
  });

  it('returns null for expired entry', async () => {
    const { cache } = await import('../../core/cache.js');
    cache.clear();
    cache.set('expires_fast', 'value', 1);
    await new Promise((r) => setTimeout(r, 10));
    const lookup = cache.get('expires_fast');
    expect(lookup).toBeNull();
  });

  it('evicts oldest entries when exceeding maxEntries', async () => {
    const { cache } = await import('../../core/cache.js');
    cache.clear();
    for (let i = 0; i < 15; i++) {
      cache.set(`key${i}`, i, 60_000);
    }
    expect(cache.size).toBe(10);
    const first = cache.get('key0');
    expect(first).toBeNull();
    const last = cache.get('key14');
    expect(last).not.toBeNull();
    expect(last!.value).toBe(14);
  });

  it('clears all entries', async () => {
    const { cache } = await import('../../core/cache.js');
    cache.clear();
    cache.set('a', 1, 60_000);
    cache.set('b', 2, 60_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('getCacheStats returns correct info', async () => {
    const { cache, getCacheStats } = await import('../../core/cache.js');
    cache.clear();
    cache.set('s1', 'v1', 60_000);
    const stats = getCacheStats();
    expect(stats.size).toBe(1);
    expect(stats.maxEntries).toBe(10);
  });
});

describe('cacheThrough', () => {
  it('loads and caches value on first call', async () => {
    const { cacheThrough } = await import('../../core/cache.js');
    const loader = vi.fn().mockResolvedValue('computed');
    const result = await cacheThrough('ct1', 60_000, loader);
    expect(result.value).toBe('computed');
    expect(result.cached).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns cached value on second call', async () => {
    const { cacheThrough } = await import('../../core/cache.js');
    const loader = vi.fn().mockResolvedValue('computed');
    await cacheThrough('ct2', 60_000, loader);
    const result = await cacheThrough('ct2', 60_000, loader);
    expect(result.cached).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads after expiry', async () => {
    const { cacheThrough } = await import('../../core/cache.js');
    const loader = vi.fn().mockResolvedValue('fresh');
    await cacheThrough('ct3', 1, loader);
    await new Promise((r) => setTimeout(r, 10));
    const result = await cacheThrough('ct3', 60_000, loader);
    expect(result.value).toBe('fresh');
    expect(result.cached).toBe(false);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('TTL constants', () => {
  it('fundEstimate is 30s', async () => {
    const { ttl } = await import('../../core/cache.js');
    expect(ttl.fundEstimate).toBe(30_000);
  });

  it('fundNavHistory is 24h', async () => {
    const { ttl } = await import('../../core/cache.js');
    expect(ttl.fundNavHistory).toBe(24 * 60 * 60 * 1000);
  });

  it('marketQuotes is 15s', async () => {
    const { ttl } = await import('../../core/cache.js');
    expect(ttl.marketQuotes).toBe(15_000);
  });

  it('fundDividends is 7d', async () => {
    const { ttl } = await import('../../core/cache.js');
    expect(ttl.fundDividends).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('all TTLs are positive', async () => {
    const { ttl } = await import('../../core/cache.js');
    const values = Object.values(ttl);
    values.forEach((v) => {
      expect(v).toBeGreaterThan(0);
    });
  });
});
