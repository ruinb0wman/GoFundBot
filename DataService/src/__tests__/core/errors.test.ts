import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('AppError', () => {
  it('creates an error with code and message', async () => {
    const { AppError } = await import('../../core/errors.js');
    const err = new AppError('INVALID_ARGUMENT', 'bad input', 400, { field: 'code' });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.message).toBe('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.detail).toEqual({ field: 'code' });
  });

  it('defaults to 500 status code', async () => {
    const { AppError } = await import('../../core/errors.js');
    const err = new AppError('INTERNAL_ERROR', 'oops');
    expect(err.statusCode).toBe(500);
  });

  it('has correct name', async () => {
    const { AppError } = await import('../../core/errors.js');
    const err = new AppError('PROVIDER_TIMEOUT', 'timeout');
    expect(err.name).toBe('AppError');
  });
});

describe('assertCode', () => {
  it('returns trimmed code for valid input', async () => {
    const { assertCode, AppError } = await import('../../core/errors.js');
    expect(assertCode(' 000001 ')).toBe('000001');
  });

  it('throws for invalid characters', async () => {
    const { assertCode, AppError } = await import('../../core/errors.js');
    expect(() => assertCode('abc def')).toThrow(AppError);
    expect(() => assertCode('<script>')).toThrow(AppError);
    expect(() => assertCode('')).toThrow(AppError);
    expect(() => assertCode(undefined)).toThrow(AppError);
  });

  it('accepts alphanumeric, dot, dash, underscore', async () => {
    const { assertCode } = await import('../../core/errors.js');
    expect(assertCode('AAPL')).toBe('AAPL');
    expect(assertCode('000001.SZ')).toBe('000001.SZ');
    expect(assertCode('a_b-c')).toBe('a_b-c');
  });

  it('uses custom field name in error message', async () => {
    const { assertCode, AppError } = await import('../../core/errors.js');
    try {
      assertCode('bad value', 'fundCode');
    } catch (e) {
      const err = e as AppError;
      expect(err.detail).toEqual({ fundCode: 'bad value' });
    }
  });
});

describe('assertNumberRange', () => {
  it('returns valid number within range', async () => {
    const { assertNumberRange } = await import('../../core/errors.js');
    expect(assertNumberRange('5', 1, 10)).toBe(5);
  });

  it('throws for NaN', async () => {
    const { assertNumberRange, AppError } = await import('../../core/errors.js');
    expect(() => assertNumberRange('abc', 1, 10)).toThrow(AppError);
  });

  it('throws for Infinity', async () => {
    const { assertNumberRange, AppError } = await import('../../core/errors.js');
    expect(() => assertNumberRange('Infinity', 1, 10)).toThrow(AppError);
    expect(() => assertNumberRange('-Infinity', 1, 10)).toThrow(AppError);
  });

  it('throws for out of range', async () => {
    const { assertNumberRange, AppError } = await import('../../core/errors.js');
    expect(() => assertNumberRange('0', 1, 10)).toThrow(AppError);
    expect(() => assertNumberRange('11', 1, 10)).toThrow(AppError);
  });

  it('accepts boundary values', async () => {
    const { assertNumberRange } = await import('../../core/errors.js');
    expect(assertNumberRange('1', 1, 10)).toBe(1);
    expect(assertNumberRange('10', 1, 10)).toBe(10);
  });
});

describe('assertDate', () => {
  it('returns valid date string', async () => {
    const { assertDate } = await import('../../core/errors.js');
    expect(assertDate('2024-01-15')).toBe('2024-01-15');
  });

  it('trims whitespace', async () => {
    const { assertDate } = await import('../../core/errors.js');
    expect(assertDate(' 2024-01-01 ')).toBe('2024-01-01');
  });

  it('throws for empty input', async () => {
    const { assertDate, AppError } = await import('../../core/errors.js');
    expect(() => assertDate('')).toThrow(AppError);
    expect(() => assertDate(undefined)).toThrow(AppError);
  });

  it('throws for invalid format', async () => {
    const { assertDate, AppError } = await import('../../core/errors.js');
    expect(() => assertDate('01-01-2024')).toThrow(AppError);
    expect(() => assertDate('2024/01/01')).toThrow(AppError);
    expect(() => assertDate('2024-13-01')).toThrow(AppError);
    expect(() => assertDate('2024-01-32')).toThrow(AppError);
  });
});

describe('toAppError', () => {
  let mod: any;

  beforeEach(async () => {
    vi.resetModules();
    mod = await import('../../core/errors.js');
  });

  it('passes through AppError', () => {
    const { AppError, toAppError } = mod;
    const original = new AppError('INVALID_ARGUMENT', 'bad', 400);
    const result = toAppError(original);
    expect(result).toBe(original);
  });

  it('maps timeout errors', () => {
    const { toAppError } = mod;
    const err = toAppError(new Error('request timeout'));
    expect(err.code).toBe('PROVIDER_TIMEOUT');
    expect(err.statusCode).toBe(504);
  });

  it('maps abort errors', () => {
    const { toAppError } = mod;
    const err = toAppError(new Error('The user aborted a request'));
    expect(err.code).toBe('PROVIDER_TIMEOUT');
    expect(err.statusCode).toBe(504);
  });

  it('maps network errors', () => {
    const { toAppError } = mod;
    const err = toAppError(new Error('network error'));
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
    expect(err.statusCode).toBe(503);
  });

  it('maps ECONN errors', () => {
    const { toAppError } = mod;
    const err = toAppError(new Error('econnrefused'));
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
    expect(err.statusCode).toBe(503);
  });

  it('maps fetch failed errors', () => {
    const { toAppError } = mod;
    const err = toAppError(new Error('fetch failed'));
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('maps unavailable errors', () => {
    const { toAppError } = mod;
    const err = toAppError(new Error('service unavailable'));
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('maps generic errors to STOCK_SDK_ERROR', () => {
    const { toAppError } = mod;
    const err = toAppError(new Error('something else'));
    expect(err.code).toBe('STOCK_SDK_ERROR');
    expect(err.statusCode).toBe(502);
  });

  it('handles non-Error objects', () => {
    const { toAppError } = mod;
    const err = toAppError('string error');
    expect(err.code).toBe('STOCK_SDK_ERROR');
    expect(err.message).toBe('string error');
  });

  it('preserves detail from source error', () => {
    const { toAppError } = mod;
    const source = new Error('custom error');
    (source as any).code = 'CUSTOM_CODE';
    const err = toAppError(source);
    expect(err.detail).toEqual({
      name: 'Error',
      message: 'custom error',
      code: 'CUSTOM_CODE',
    });
  });
});
