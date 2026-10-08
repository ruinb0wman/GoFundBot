/**
 * 实时页（`/portfolio` 的「实时估值」标签）的组合数据工具 —— 与前端 `services/portfolioApi.ts`
 * 走同一批 service 函数（真源 service SQLite，迁移 006）。
 *
 * 口径（与前端 `useFundRealtimeTrade.settleTrade` / `buildTradeRecord` 一致，务必写进 description）：
 * - 持仓是**推导值**，不落表：只有 `status='settled'` 的交易计入；
 * - `buy`：`share = amount / nav`，成本按金额加权平均；
 * - `sell`：`amount = share × nav`（**传的是份额**），减到 ≤0.01 时整只消失；
 * - `dividend` 加份额、`fee` 累加 `total_fee`；
 * - 当天净值还没出来的交易挂 `status='pending'`，之后用 `settle_trades` 结算。
 *
 * 所有写操作都是 `readOnly: false` → 走确认令牌。
 */
import { z } from 'zod'
import { defineAgentTool } from './types.js'
import { resolveFund } from './fundLookup.js'
import {
  addPortfolioFund,
  addPortfolioTrade,
  createPortfolioGroup,
  deletePortfolioGroup,
  deletePortfolioTrade,
  getHoldings,
  getPortfolioGroupMap,
  listPortfolioFunds,
  listPortfolioGroups,
  listPortfolioTrades,
  removePortfolioFund,
  settlePortfolioTrades,
  syncPortfolioGroupMap,
  updatePortfolioGroup,
  type GroupInput,
} from '../services/portfolioService.js'

const fundCode = z.string().regex(/^\d{6}$/).describe('6 位基金代码')

/** 把「某几只基金设成某个分组」合并进现有映射（`PUT /fund-group-map` 是整体替换语义）。 */
function assignGroup(codes: string[], groupId: number | null): Record<string, number> {
  const current = getPortfolioGroupMap()
  for (const code of codes) {
    if (groupId === null) delete current[code]
    else current[code] = groupId
  }
  return syncPortfolioGroupMap(Object.entries(current).map(([code, id]) => ({ fund_code: code, group_id: id })))
}

function groupExists(groupId: number): boolean {
  return listPortfolioGroups().some((group) => group.id === groupId)
}

export const portfolioTools = [
  defineAgentTool({
    name: 'get_portfolio',
    label: '读取实时组合',
    description:
      '一次性读取实时页的组合数据：组合基金列表（funds）、分组（groups，含再平衡配置）、'
      + '基金↔分组映射（fund_group_map）与**推导出来的持仓**（holdings，按基金代码索引：share/cost/total_fee/buy_date）。'
      + '持仓只由已结算交易推导 —— 想让某只基金出现在持仓里，得先 add_trade。',
    promptSnippet: 'get_portfolio(): 组合基金 + 分组 + 映射 + 推导持仓',
    params: z.object({}),
    readOnly: true,
    handler: async () => ({
      funds: listPortfolioFunds(),
      groups: listPortfolioGroups(),
      fund_group_map: getPortfolioGroupMap(),
      holdings: getHoldings(),
    }),
  }),

  defineAgentTool({
    name: 'add_portfolio_fund',
    label: '加入实时组合',
    description:
      '把一只基金加入实时页的组合列表（写 service SQLite，前端「实时估值」标签可见；已在列表里则只更新名称/类型）。'
      + '注意这与自选（watchlist）是**两个不同的列表**。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'add_portfolio_fund(fund_code, group_id?): 加入实时组合（需确认）',
    params: z.object({
      fund_code: fundCode,
      group_id: z.number().int().positive().optional().describe('顺带分到哪个分组（来自 get_portfolio.groups）'),
      fund_name: z.string().optional().describe('基金名称（不填则自动从数据源补全）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, fund_code, group_id, fund_name } = args
      if (group_id !== undefined && !groupExists(group_id)) {
        return { error: `分组 ${group_id} 不存在（用 get_portfolio 查 groups）` }
      }
      const resolved = fund_name ? { fundName: fund_name, fundType: null } : await resolveFund(fund_code)
      const saved = addPortfolioFund({ fund_code, fund_name: resolved.fundName, fund_type: resolved.fundType })
      if (group_id) assignGroup([fund_code], group_id)
      return { saved, funds: listPortfolioFunds(), fund_group_map: getPortfolioGroupMap() }
    },
  }),

  defineAgentTool({
    name: 'remove_portfolio_fund',
    label: '移出实时组合',
    description:
      '把一只基金移出实时页的组合列表（同时清掉它的分组映射；**不会**删交易记录/持仓）。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'remove_portfolio_fund(fund_code): 移出实时组合（需确认）',
    params: z.object({
      fund_code: fundCode,
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, fund_code } = args
      return { removed: fund_code, funds: removePortfolioFund(fund_code) }
    },
  }),

  defineAgentTool({
    name: 'save_portfolio_group',
    label: '保存组合分组',
    description:
      '新建或更新一个组合分组（实时页的「分组」；可带再平衡配置：enabled/target/upper/lower，都是百分数）。'
      + '不传 id = 新建（需 name）；传 id = 更新（只改传入的字段）。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'save_portfolio_group(name, id?, rebalance_*?): 新建/更新分组（需确认）',
    params: z.object({
      id: z.number().int().positive().optional().describe('要更新的分组 id（来自 get_portfolio.groups）；不填则新建'),
      name: z.string().min(1).max(40).optional().describe('分组名（新建必填）'),
      rebalance_enabled: z.boolean().optional().describe('是否启用再平衡'),
      rebalance_target: z.number().nullable().optional().describe('目标仓位（%，如 60）'),
      rebalance_upper: z.number().nullable().optional().describe('上界（%，如 70）'),
      rebalance_lower: z.number().nullable().optional().describe('下界（%，如 50）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id, ...rest } = args
      const patch: Partial<GroupInput> = {
        ...(rest.name !== undefined ? { name: rest.name } : {}),
        ...(rest.rebalance_enabled !== undefined ? { rebalance_enabled: rest.rebalance_enabled ? 1 : 0 } : {}),
        ...(rest.rebalance_target !== undefined ? { rebalance_target: rest.rebalance_target } : {}),
        ...(rest.rebalance_upper !== undefined ? { rebalance_upper: rest.rebalance_upper } : {}),
        ...(rest.rebalance_lower !== undefined ? { rebalance_lower: rest.rebalance_lower } : {}),
      }
      if (id) {
        const updated = updatePortfolioGroup(id, patch)
        if (!updated) return { error: `分组 ${id} 不存在（用 get_portfolio 查 id）` }
        return { saved: updated, groups: listPortfolioGroups() }
      }
      if (!rest.name) return { error: '新建分组需要 name（要更新已有分组请传 id）' }
      return { saved: createPortfolioGroup(patch as GroupInput), groups: listPortfolioGroups() }
    },
  }),

  defineAgentTool({
    name: 'delete_portfolio_group',
    label: '删除组合分组',
    description:
      '删除一个组合分组（组内基金的映射随外键级联删除，基金本身回到「未分组」）。'
      + '**破坏性写入**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'delete_portfolio_group(id): 删除分组（需用户确认）',
    params: z.object({
      id: z.number().int().positive().describe('要删除的分组 id（来自 get_portfolio.groups）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id } = args
      const target = listPortfolioGroups().find((group) => group.id === id)
      if (!target) return { error: `分组 ${id} 不存在（用 get_portfolio 查 id）` }
      return { deleted: { id, name: target.name }, groups: deletePortfolioGroup(id) }
    },
  }),

  defineAgentTool({
    name: 'assign_funds_to_group',
    label: '基金分组',
    description:
      '把一批基金移到某个分组（`group_id` 传 null = 取消分组）。只影响这几只基金，其余映射保持不变。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'assign_funds_to_group(fund_codes, group_id?): 基金分组（需确认）',
    params: z.object({
      fund_codes: z.array(fundCode).min(1).describe('要分组的基金代码列表'),
      group_id: z.number().int().positive().nullable().optional().describe('目标分组 id；null / 不传 = 取消分组'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, fund_codes, group_id } = args
      if (group_id !== undefined && group_id !== null && !groupExists(group_id)) {
        return { error: `分组 ${group_id} 不存在（用 get_portfolio 查 groups）` }
      }
      return { fund_group_map: assignGroup(fund_codes, group_id ?? null) }
    },
  }),

  defineAgentTool({
    name: 'add_trade',
    label: '记录一笔交易',
    description:
      '给实时页记录一笔交易（写 service SQLite，前端「实时估值」/基金详情的交易记录可见，并会改变推导持仓）。'
      + '金额/份额可以只传一个，工具会按净值换算：`buy` 只需 amount + nav（share = amount / nav）；'
      + '`sell` 只需 share + nav（amount = share × nav）；`dividend` 分红再投传 share（或 amount + nav）；`fee` 手续费传 amount。'
      + '当天净值还没出来的交易传 status="pending"，之后用 settle_trades 结算。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'add_trade(fund_code, type, trade_date, amount|share, nav, status?): 记一笔交易（需确认）',
    params: z.object({
      fund_code: fundCode,
      type: z.enum(['buy', 'sell', 'dividend', 'fee']).describe('交易类型（buy 买 / sell 卖 / dividend 分红再投 / fee 手续费）'),
      trade_date: z.string().describe('交易日期 YYYY-MM-DD'),
      amount: z.number().nonnegative().optional().describe('金额（元）：buy/fee 传它；sell 不传则由 share × nav 算'),
      share: z.number().nonnegative().optional().describe('份额：sell/dividend 传它；buy 不传则由 amount / nav 算'),
      nav: z.number().nonnegative().optional().describe('成交净值（buy/sell 必需；fee 可省）'),
      status: z.enum(['settled', 'pending']).optional().describe('默认 settled；当天净值未出时用 pending'),
      txn_id: z.string().optional().describe('挂单号（pending 交易用它结算；不填则自动生成）'),
      note: z.string().optional().describe('备注'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, ...rest } = args
      const nav = rest.nav ?? 0
      let amount = rest.amount ?? 0
      let share = rest.share ?? 0
      let tradeNav = nav
      if (rest.type === 'buy') {
        if (!share && amount && nav) share = amount / nav
        if (!amount && share && nav) amount = share * nav
        if (!amount || !nav) return { error: '买入需要 amount + nav（或 share + nav）' }
      } else if (rest.type === 'sell') {
        if (!share && amount && nav) share = amount / nav
        if (!amount && share && nav) amount = share * nav
        if (!share || !nav) return { error: '卖出需要 share + nav（或 amount + nav）' }
      } else if (rest.type === 'dividend') {
        if (!tradeNav && share && amount) tradeNav = amount / share
        if (!share) return { error: '分红再投需要 share（新增份额）' }
      } else if (!amount) {
        return { error: '手续费需要 amount' }
      }
      const { fundName } = await resolveFund(rest.fund_code)
      return {
        saved: addPortfolioTrade({ ...rest, amount, share, nav: tradeNav, fund_name: fundName }),
        holdings: getHoldings(),
      }
    },
  }),

  defineAgentTool({
    name: 'settle_trades',
    label: '结算挂单交易',
    description:
      '把 pending 的交易按 txn_id 结算（status → settled，写入 settled_at），结算后这些交易开始计入推导持仓。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'settle_trades(txn_ids): 结算挂单交易（需确认）',
    params: z.object({
      txn_ids: z.array(z.string().min(1)).min(1).describe('要结算的挂单号列表（来自 get_portfolio / 交易记录的 txn_id）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, txn_ids } = args
      settlePortfolioTrades(txn_ids)
      return { settled: txn_ids, trades: listPortfolioTrades(), holdings: getHoldings() }
    },
  }),

  defineAgentTool({
    name: 'delete_trade',
    label: '删除交易记录',
    description:
      '删除一条交易记录（会改变推导持仓；要清空全部请让用户在页面上操作）。'
      + '**破坏性写入**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'delete_trade(id): 删除交易记录（需用户确认）',
    params: z.object({
      id: z.number().int().positive().describe('交易记录 id（来自 get_portfolio 或 GET /api/user/portfolio/trades）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id } = args
      const target = listPortfolioTrades().find((trade) => trade.id === id)
      if (!target) return { error: `交易记录 ${id} 不存在` }
      deletePortfolioTrade(id)
      return { deleted: { id, fund_code: target.fund_code, type: target.type }, holdings: getHoldings() }
    },
  }),
]
