import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import dns from 'node:dns';

const { fetchUrl } = await import('../../core/fetch.js');

/**
 * `ipv4first` 的**机制**回归（不依赖外网）。
 *
 * 复刻 push2 的真实故障形状：同一 hostname 同时解析到 IPv6 / IPv4 两个「边缘」，
 * 而 **IPv6 那个 TCP 一连上就断**（push2 就是 `UND_ERR_SOCKET other side closed`）。
 * 在 Node 26 上实测：`verbatim` 顺序（::1 排前）**3/3 直接失败** —— `net.connect` 的
 * Happy Eyeballs 在首个候选「被拒」时不会换族重试（`autoSelectFamily` 默认为 true 也没用）；
 * `ipv4first` 3/3 成功、且请求确实落在 IPv4 边缘上。
 *
 * 这里用 `localhost`（本机 hosts 同时给出 ::1 与 127.0.0.1）当那个双栈 hostname，
 * 但断言的是我们真正依赖的性质：**IPv6 边缘拒连时，`core/fetch.ts` 的直连请求仍能成功**。
 */
describe('IPv4 优先（push2 边缘拒连的形状）', () => {
  let badV6: net.Server | null = null;
  let goodV4: http.Server | null = null;
  let port = 0;
  let v4Hits = 0;
  let v6Supported = false;

  beforeAll(async () => {
    // 没有 IPv6 环回的环境直接跳过（容器里常见）
    try {
      const probe = net.createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '::1', () => resolve());
      });
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      v6Supported = true;
    } catch {
      v6Supported = false;
    }
    if (!v6Supported) return;

    goodV4 = http.createServer((_req, res) => {
      v4Hits += 1;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok-from-ipv4');
    });
    await new Promise<void>((resolve) => goodV4!.listen(0, '127.0.0.1', () => resolve()));
    port = (goodV4!.address() as net.AddressInfo).port;

    // 同端口的「拒绝型 IPv6 边缘」：accept 后立刻断
    badV6 = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      badV6!.once('error', reject);
      badV6!.listen(port, '::1', () => resolve());
    });
  });

  afterAll(async () => {
    dns.setDefaultResultOrder('ipv4first');
    await new Promise<void>((resolve) => (badV6 ? badV6.close(() => resolve()) : resolve()));
    await new Promise<void>((resolve) => (goodV4 ? goodV4.close(() => resolve()) : resolve()));
  });

  it('serves through the IPv4 edge even when the IPv6 edge refuses', async ({ skip }) => {
    if (!v6Supported) skip();

    const order = await new Promise((resolve) =>
      dns.lookup('localhost', { all: true }, (_, addresses) => resolve(addresses)),
    );
    // ipv4first 生效时 localhost 的 IPv4 地址必须排在前面（否则这个用例前提不成立）
    expect((order as { family: number }[])[0]?.family).toBe(4);

    const text = await fetchUrl<string>(`http://localhost:${port}/`, { proxy: 'never', timeoutMs: 5000 });
    expect(text).toBe('ok-from-ipv4');
    expect(v4Hits).toBe(1); // 确实落在 IPv4 边缘，而不是「IPv6 失败后重试」的巧合
  });
});
