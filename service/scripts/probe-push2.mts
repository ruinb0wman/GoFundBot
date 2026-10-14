/**
 * push2 只读诊断脚本：比较三种 dispatcher 的成功率与耗时。
 *
 *   cd service && bunx tsx scripts/probe-push2.mts [rounds] [url]
 *
 * ⚠️ **不要连发**：push2 是主机级限流的，几十个请求就能把整条 host 打进「持续数小时全拒」的状态
 * （2026-10-14 就是这么发生的，见 `.pi/plans/push2-resilience.md` §5.4）。默认 3 轮、变体交错，
 * 一共 9 个请求；要更多轮请先想清楚是不是非做不可。
 *
 * 三列的含义：
 *   A 默认 verbatim  —— 修之前的形状（IPv6 边缘排前）
 *   B ipv4first      —— 现在 `core/fetch.ts` 装上的进程级设置
 *   C family: 4      —— 更硬的「只用 IPv4」，只作对照，不建议上生产
 */
import dns from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';

const rounds = Number(process.argv[2] ?? 3);
const url =
  process.argv[3] ??
  'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=3&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f12,f14,f3,f62';

const variants = [
  { name: 'A 默认', order: 'verbatim' as const, agent: new Agent() },
  { name: 'B ipv4first', order: 'ipv4first' as const, agent: new Agent() },
  { name: 'C family:4', order: 'verbatim' as const, agent: new Agent({ connect: { family: 4 } }) },
];

const stat = new Map(variants.map((v) => [v.name, { ok: 0, ms: [] as number[] }]));
const errors = new Map<string, number>();
const bump = (key: string) => errors.set(key, (errors.get(key) ?? 0) + 1);

for (let round = 1; round <= rounds; round++) {
  for (const v of variants) {
    dns.setDefaultResultOrder(v.order);
    const t0 = Date.now();
    try {
      const res = await undiciFetch(url, {
        dispatcher: v.agent,
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.text();
      if (res.status === 200 && body.includes('"total"')) {
        const s = stat.get(v.name)!;
        s.ok += 1;
        s.ms.push(Date.now() - t0);
      } else {
        bump(`${v.name} 响应异常 ${res.status}`);
      }
    } catch (e) {
      const err = e as { cause?: { code?: string }; code?: string; name?: string };
      bump(`${v.name} ${err.cause?.code ?? err.code ?? err.name}`);
    }
  }
}

dns.setDefaultResultOrder('verbatim');
console.log(`url: ${url}\nrounds: ${rounds}（变体交错，共 ${rounds * variants.length} 个请求）\n`);
for (const v of variants) {
  const s = stat.get(v.name)!;
  const sorted = [...s.ms].sort((a, b) => a - b);
  const median = sorted.length ? `${sorted[Math.floor(sorted.length / 2)]}ms` : '-';
  console.log(`${v.name.padEnd(14)} ${`${s.ok}/${rounds}`.padEnd(8)} 成功耗时中位数 ${median}`);
}
if (errors.size > 0) {
  console.log('\n错误分布：');
  for (const [key, count] of errors) console.log(`  ${count}× ${key}`);
}
await Promise.all(variants.map((v) => v.agent.close()));
