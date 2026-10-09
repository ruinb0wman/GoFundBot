import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));

vi.mock('../../core/fetch.js', () => ({ fetchUrl: fetchUrlMock }));

const { fetchText, resetEastmoneyBreakers } = await import('../../providers/eastmoney/eastmoneyRequest.js');

/**
 * 东财请求的两个不变量（`.pi/plans/push2-resilience.md` §3）：
 *
 * 1. **必须直连**（`proxy: 'never'`）—— 曾经是 `'auto'`，经代理出口时 push2 全被 RST。
 * 2. **端点级熔断**：连续失败 3 次 → 冷却 60s（直接快速失败），别每次都等满超时。
 */

const ULIST = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2';
const CLIST = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1';

beforeEach(() => {
  fetchUrlMock.mockReset();
  resetEastmoneyBreakers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('eastmoney fetchText', () => {
  it('always goes direct (proxy: never)', async () => {
    fetchUrlMock.mockResolvedValue('{"ok":true}');

    await fetchText(ULIST, 5000, 'https://quote.eastmoney.com/');

    expect(fetchUrlMock.mock.calls[0][1]).toMatchObject({
      proxy: 'never',
      timeoutMs: 5000,
      headers: { Referer: 'https://quote.eastmoney.com/' },
    });
  });

  it('opens a cooldown after 3 consecutive failures and stops hitting the network', async () => {
    fetchUrlMock.mockRejectedValue(new Error('UND_ERR_SOCKET'));

    for (let i = 0; i < 3; i++) {
      await expect(fetchText(ULIST)).rejects.toThrow('UND_ERR_SOCKET');
    }
    expect(fetchUrlMock).toHaveBeenCalledTimes(3);

    // 第 4 次：冷却期内直接抛，不再发起请求
    await expect(fetchText(ULIST)).rejects.toThrow(/cooling down/);
    expect(fetchUrlMock).toHaveBeenCalledTimes(3);
  });

  it('keeps breakers per endpoint (a dead ulist must not block clist)', async () => {
    fetchUrlMock.mockImplementation((url: string) => {
      if (url.startsWith('https://push2.eastmoney.com/api/qt/ulist.np')) {
        return Promise.reject(new Error('UND_ERR_SOCKET'));
      }
      return Promise.resolve('{"ok":true}');
    });

    for (let i = 0; i < 3; i++) {
      await expect(fetchText(ULIST)).rejects.toThrow('UND_ERR_SOCKET');
    }
    await expect(fetchText(ULIST)).rejects.toThrow(/cooling down/);

    await expect(fetchText(CLIST)).resolves.toBe('{"ok":true}');
  });

  it('resets the counter on success (2 fails + 1 ok + 2 fails 仍不熔断)', async () => {
    const fail = () => Promise.reject(new Error('UND_ERR_SOCKET'));
    fetchUrlMock.mockImplementationOnce(fail).mockImplementationOnce(fail);
    fetchUrlMock.mockResolvedValueOnce('{"ok":true}');
    fetchUrlMock.mockImplementationOnce(fail).mockImplementationOnce(fail);

    await expect(fetchText(ULIST)).rejects.toThrow();
    await expect(fetchText(ULIST)).rejects.toThrow();
    await expect(fetchText(ULIST)).resolves.toBe('{"ok":true}');
    await expect(fetchText(ULIST)).rejects.toThrow();
    await expect(fetchText(ULIST)).rejects.toThrow();

    // 第 6 次仍应真的发起请求（计数已被成功清零）
    fetchUrlMock.mockResolvedValueOnce('{"ok":true}');
    await expect(fetchText(ULIST)).resolves.toBe('{"ok":true}');
    expect(fetchUrlMock).toHaveBeenCalledTimes(6);
  });

  it('re-open after a failed probe once the cooldown has elapsed', async () => {
    vi.useFakeTimers();
    fetchUrlMock.mockRejectedValue(new Error('UND_ERR_SOCKET'));

    for (let i = 0; i < 3; i++) {
      await expect(fetchText(ULIST)).rejects.toThrow('UND_ERR_SOCKET');
    }
    await expect(fetchText(ULIST)).rejects.toThrow(/cooling down/);

    vi.advanceTimersByTime(61_000);

    // 冷却过后允许一次探测（会真的打网络），失败后立刻重新开闸
    await expect(fetchText(ULIST)).rejects.toThrow('UND_ERR_SOCKET');
    await expect(fetchText(ULIST)).rejects.toThrow(/cooling down/);
    expect(fetchUrlMock).toHaveBeenCalledTimes(4);
  });
});
