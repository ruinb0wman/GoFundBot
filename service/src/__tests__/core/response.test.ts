import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { sendSuccess, sendFailure, makeMeta } from '../../core/response.js';

function mockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('sendSuccess', () => {
  it('wraps plain data in success envelope', () => {
    const res = mockResponse();
    sendSuccess(res, { foo: 'bar' });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { foo: 'bar' },
      meta: expect.objectContaining({
        source: 'Service',
        cached: false,
        fallback: false,
        stale: false,
      }),
    });
  });

  it('wraps ServiceResult correctly', () => {
    const res = mockResponse();
    const updatedAt = new Date('2024-01-01');
    sendSuccess(res, {
      data: [1, 2, 3],
      provider: 'eastmoney',
      fallback: true,
      cached: false,
      stale: false,
      updatedAt,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [1, 2, 3],
      meta: expect.objectContaining({
        provider: 'eastmoney',
        fallback: true,
        cached: false,
      }),
    });
  });
});

describe('sendFailure', () => {
  it('sends error with correct status code', () => {
    const res = mockResponse();
    sendFailure(res, 400, { code: 'INVALID_ARGUMENT', message: 'bad request' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'INVALID_ARGUMENT', message: 'bad request' },
      meta: expect.objectContaining({ source: 'Service' }),
    });
  });

  it('sends 500 by default error', () => {
    const res = mockResponse();
    sendFailure(res, 500, { code: 'INTERNAL_ERROR', message: 'oops' });
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('includes detail when provided', () => {
    const res = mockResponse();
    sendFailure(res, 403, {
      code: 'INVALID_ARGUMENT',
      message: 'forbidden',
      detail: { field: 'code' },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          detail: { field: 'code' },
        }),
      }),
    );
  });
});

describe('makeMeta', () => {
  it('creates meta with defaults', () => {
    const meta = makeMeta();
    expect(meta.source).toBe('Service');
    expect(meta.provider).toBeNull();
    expect(meta.fallback).toBe(false);
    expect(meta.cached).toBe(false);
    expect(meta.stale).toBe(false);
    expect(meta.updatedAt).toBeDefined();
  });

  it('sets cached flag', () => {
    const meta = makeMeta(true);
    expect(meta.cached).toBe(true);
  });

  it('sets provider and fallback', () => {
    const meta = makeMeta(false, new Date(), 'eastmoney', true, true);
    expect(meta.provider).toBe('eastmoney');
    expect(meta.fallback).toBe(true);
    expect(meta.stale).toBe(true);
  });
});
