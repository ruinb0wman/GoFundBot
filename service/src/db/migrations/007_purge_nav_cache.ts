import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './types.js';

/**
 * 清空净值缓存（一次性）。
 *
 * 2026-10-09 修 provider 之前，净值链 `[joinquant, tencent, stock-sdk, eastmoney]` 里
 * 前两个都不可用（joinquant 无 key；腾讯 `web.ifzq.gtimg.cn/app/fund/funddaily` 返回
 * `Can't load controller: FundController`），于是实际由 stock-sdk 供数；而 stock-sdk 用
 * `new Date(x).toISOString()`（UTC）格式化东财「北京时间零点」的时间戳，导致**整条序列早一天**
 * （数值本身没错，只是日期标错，连周日的净值都会出现）。
 *
 * 修完后重新取数会写入正确日期，但旧的错误日期是另一批主键（`(fund_code, date)`），
 * 不会被覆盖而残留成「多出来的一天」。所以这里整表清掉，让下次访问重新拉。
 * 净值是纯缓存、可随时从上游重建；清空只影响首次访问的延迟，不影响任何用户数据。
 */
export const migration007: Migration = {
  version: 7,
  name: 'purge_stale_nav_dates',
  up(db: DatabaseSync): void {
    db.exec(`
      DELETE FROM nav_history;
      DELETE FROM nav_history_meta;
    `);
  },
};
