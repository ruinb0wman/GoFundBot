/**
 * 指数估值 DTO（`GET /api/market/index/:code/valuation`）。
 *
 * 约定与涨跌家数一致：取不到时仍返回 200，靠 `data_status` 表达，
 * 上面那些数字此时是 `null` —— **不要**读成 0。
 */
export interface IndexValuationDto {
  /** 我们的规范代码，如 `sh000300` */
  code: string;
  /** 数据源代码，如 `SH000300` */
  source_code: string | null;
  /** 数据源不返名称，恒为 null；前端用详情页的 `name` */
  name: string | null;
  /** 历史末点日期（北京时间，YYYY-MM-DD） */
  as_of: string;
  data_status: 'available' | 'unavailable';
  /** 加权滚动市盈率（TTM） */
  pe: number | null;
  /** 当前 PE 在窗口内的分位（0..1） */
  percentile: number | null;
  bands: {
    /** 窗口内 20% 分位值 */
    opportunity: number | null;
    /** 窗口内 50% 分位值 */
    median: number | null;
    /** 窗口内 80% 分位值 */
    danger: number | null;
  };
  source: 'danjuan';
  /** 口径说明，前端原样展示（跨源不可比，见 docs/market-index-valuation.md） */
  definition: string;
  window: {
    start: string;
    end: string;
    points: number;
    freq: 'weekly';
  } | null;
  /** 仅 `unavailable` 时给出原因 */
  error?: string;
}
