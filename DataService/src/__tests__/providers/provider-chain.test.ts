import { describe, it, expect, vi } from 'vitest';
import { ProviderChain } from '../../core/providerChain.js';

describe('ProviderChain', () => {
  it('returns data from the first provider on success', async () => {
    const p1 = { name: 'primary' };
    const p2 = { name: 'fallback' };
    const chain = new ProviderChain([p1, p2]);
    const result = await chain.run('test', async (p) => {
      if (p.name === 'primary') return 'primary_data';
      throw new Error('should not reach fallback');
    });
    expect(result.data).toBe('primary_data');
    expect(result.provider).toBe('primary');
    expect(result.fallback).toBe(false);
  });

  it('falls back to second provider when first fails', async () => {
    const p1 = { name: 'primary' };
    const p2 = { name: 'fallback' };
    const chain = new ProviderChain([p1, p2]);
    const result = await chain.run('test', async (p) => {
      if (p.name === 'primary') throw new Error('primary failed');
      return 'fallback_data';
    });
    expect(result.data).toBe('fallback_data');
    expect(result.provider).toBe('fallback');
    expect(result.fallback).toBe(true);
  });

  it('throws when all providers fail', async () => {
    const p1 = { name: 'primary' };
    const p2 = { name: 'fallback' };
    const chain = new ProviderChain([p1, p2]);
    await expect(
      chain.run('test', async () => {
        throw new Error('always fails');
      })
    ).rejects.toThrow('All providers failed for test');
  });

  it('records provider errors in result on success after fallback', async () => {
    const p1 = { name: 'primary' };
    const p2 = { name: 'secondary' };
    const chain = new ProviderChain([p1, p2]);
    const result = await chain.run('test', async (p) => {
      if (p.name === 'primary') throw new Error('primary exploded');
      return 'ok';
    });
    expect(result.providerErrors).toHaveLength(1);
    expect(result.providerErrors[0].provider).toBe('primary');
    expect(result.providerErrors[0].message).toBe('primary exploded');
  });

  it('records all provider errors when all fail', async () => {
    const p1 = { name: 'p1' };
    const p2 = { name: 'p2' };
    const chain = new ProviderChain([p1, p2]);
    try {
      await chain.run('test', async (p) => {
        throw new Error(`${p.name} error`);
      });
    } catch (e: any) {
      const errors = e.detail?.providerErrors;
      expect(errors).toHaveLength(2);
      expect(errors[0].provider).toBe('p1');
      expect(errors[1].provider).toBe('p2');
    }
  });

  it('works with single provider', async () => {
    const p1 = { name: 'solo' };
    const chain = new ProviderChain([p1]);
    const result = await chain.run('test', async () => 'solo_data');
    expect(result.data).toBe('solo_data');
    expect(result.provider).toBe('solo');
    expect(result.fallback).toBe(false);
  });

  it('handles non-Error provider failures', async () => {
    const p1 = { name: 'primary' };
    const p2 = { name: 'backup' };
    const chain = new ProviderChain([p1, p2]);
    const result = await chain.run('test', async (p) => {
      if (p.name === 'primary') throw 'string error';
      return 'recovered';
    });
    expect(result.data).toBe('recovered');
    expect(result.providerErrors[0].message).toBe('string error');
  });
});
