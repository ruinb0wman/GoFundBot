import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici';
import { fetchUrl, setGlobalProxyUrl } from '../../core/fetch.js';

/**
 * `proxy: 'never'` 必须是「真直连」。
 *
 * 回归 bug（`.pi/plans/push2-resilience.md` §1.1）：`getDispatcher('never')` 返回 `undefined`，
 * 而本机环境有 `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY` → Node 的全局 dispatcher 是
 * `EnvHttpProxyAgent`，「不传 dispatcher」等于「随全局」→ 标了 `never` 的国内请求照样绕
 * 代理出去，东财 push2 因此被 RST（板块长期走 akshare 降级）。
 *
 * 这两个用例用「假代理 + 本地 origin」把行为钉死，不需要外网。
 */

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  return address.port;
}

/** 假代理：任何请求都记一笔并回 `proxied`（undici 的 ProxyAgent 对 http 目标发绝对 URI） */
async function startFakeProxy() {
  const state = { hits: 0 };
  const server = createServer((_req, res) => {
    state.hits += 1;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('proxied');
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    get hits() {
      return state.hits;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startOrigin() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('direct');
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const originalDispatcher: Dispatcher = getGlobalDispatcher();
const originalEnv = {
  https: process.env.HTTPS_PROXY,
  http: process.env.HTTP_PROXY,
  useEnvProxy: process.env.NODE_USE_ENV_PROXY,
};

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  setGlobalProxyUrl(null);
  setGlobalDispatcher(originalDispatcher);
  for (const [name, value] of [
    ['HTTPS_PROXY', originalEnv.https],
    ['HTTP_PROXY', originalEnv.http],
    ['NODE_USE_ENV_PROXY', originalEnv.useEnvProxy],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

describe("fetchUrl proxy: 'never'", () => {
  it('bypasses the env proxy even when the global dispatcher is EnvHttpProxyAgent', async () => {
    const proxy = await startFakeProxy();
    const origin = await startOrigin();
    cleanups.push(() => proxy.close(), () => origin.close());

    // 模拟 NODE_USE_ENV_PROXY=1 生效后的全局 dispatcher（noProxy 清空，避免 127.* 被豁免）
    setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: proxy.url, httpsProxy: proxy.url, noProxy: '' }));

    const text = await fetchUrl<string>(origin.url, { proxy: 'never', timeoutMs: 2000 });

    expect(text).toBe('direct');
    expect(proxy.hits).toBe(0);
  });

  it("keeps proxy: 'auto' going through the configured proxy", async () => {
    const proxy = await startFakeProxy();
    const origin = await startOrigin();
    cleanups.push(() => proxy.close(), () => origin.close());

    setGlobalProxyUrl(proxy.url);

    const text = await fetchUrl<string>(origin.url, { proxy: 'auto', timeoutMs: 2000 });

    expect(text).toBe('proxied');
    expect(proxy.hits).toBe(1);
  });
});
