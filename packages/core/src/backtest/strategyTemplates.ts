/**
 * Starter snippets offered in the workspace editor's 「模板」 menu.
 *
 * Every snippet is a full module: `prepare(sdk)` declares the fixed pool + window,
 * `onDay(s)` decides per trading day (addressed by fund code). Omitting `start`/`end`
 * in `prepare` means "last three years" (the host default).
 */

export interface StrategyTemplate {
  key: string
  label: string
  hint: string
  code: string
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    key: 'equal-dca',
    label: '等权定投',
    hint: '两只 ETF，每月 1 号各买 500 元',
    code: `function prepare(sdk) {
  // 省略 start/end = 默认近三年
  return { assets: ['510300', '518880'], feeRate: 0.0015 };
}

function onDay(s) {
  if (s.date.slice(8) !== '01') return {};
  return { buy: s.codes.map((code) => ({ code, amount: 500 })) };
}`,
  },
  {
    key: 'momentum-rotation',
    label: '动量轮动',
    hint: '每月持有 20 日涨幅最高的一只 ETF',
    code: `function prepare(sdk) {
  return { assets: ['510300', '510500', '159915', '518880', '511010'] };
}

function onDay(s) {
  if (s.date.slice(8) !== '01') return {};
  const best = [...s.codes].sort((a, b) => s.pctChange(b, 20) - s.pctChange(a, 20))[0];
  const targets = Object.fromEntries(s.codes.map((code) => [code, code === best ? 1 : 0]));
  return { rebalance: targets, buy: [{ code: best, amount: 1000 }] };
}`,
  },
  {
    key: 'threshold-rebalance',
    label: '阈值再平衡',
    hint: '等权四腿，任一偏离目标 5 个百分点就调回',
    code: `function prepare(sdk) {
  return { assets: ['510300', '511010', '518880', 'CASH:0.02'], initialAmount: 100000 };
}

function onDay(s) {
  const target = 1 / s.codes.length;
  const weights = s.codes.map((code) => s.weight(code));
  if (Math.max(...weights) - target > 0.05) {
    return { rebalance: Object.fromEntries(s.codes.map((code) => [code, target])) };
  }
  return {};
}`,
  },
  {
    key: 'ma-dip-buy',
    label: '均线偏离加码',
    hint: '净值低于 60 日均线时多买，高于时少买',
    code: `function prepare(sdk) {
  return { assets: ['110022'] };
}

function onDay(s) {
  const ma = s.ma('110022', 60);
  return { buy: [{ code: '110022', amount: s.nav('110022') < ma ? 2000 : 500 }] };
}`,
  },
  {
    key: 'screen-pool',
    label: '从基金库选池',
    hint: '按近一年夏普取前 5 只，等额每月买入',
    code: `function prepare(sdk) {
  const pool = sdk.screen()
    .filter((row) => row.sharpe_ratio_1y != null)
    .sort((a, b) => b.sharpe_ratio_1y - a.sharpe_ratio_1y)
    .slice(0, 5)
    .map((row) => row.code);
  return { assets: pool };
}

function onDay(s) {
  if (s.date.slice(8) !== '01') return {};
  return { buy: s.codes.map((code) => ({ code, amount: 300 })) };
}`,
  },
  {
    key: 'core-permanent',
    label: '核心·永久投资组合',
    hint: '股/债/黄金/现金各 25%（股腿沪深300+标普500），每年拉回目标权重',
    code: `/* 只有核心：永久投资组合 = 股 / 债 / 黄金 / 现金 各 25%，每年拉回目标权重，不含卫星 */
/* 股腿拆两只：沪深300 12.5% + 标普500 12.5%；现金腿用货基；start/end 可自行改 */
var CORE = ['000961', '513500', '004102', '000216', '000682'];
var REL = { '000961': 0.125, '513500': 0.125, '004102': 0.25, '000216': 0.25, '000682': 0.25 };

function prepare(sdk) {
  return { start: '2020-02-19', end: '2026-10-08', assets: CORE, initialAmount: 100000, feeRate: 0.0015 };
}

var ready = false, yr = null;
function target() {
  var w = {}, i;
  for (i = 0; i < CORE.length; i++) w[CORE[i]] = REL[CORE[i]];
  return { rebalance: w };
}

function onDay(s) {
  var y = s.date.slice(0, 4);
  if (!ready) { ready = true; yr = y; return target(); }   // 第 0 天：按目标权重建仓
  if (y !== yr) { yr = y; return target(); }               // 每年首个交易日：拉回四资产各 25%
  return {};
}`,
  },
]

/** New-scheme default so the editor is immediately runnable. */
export const DEFAULT_STRATEGY_CODE = STRATEGY_TEMPLATES[0].code
