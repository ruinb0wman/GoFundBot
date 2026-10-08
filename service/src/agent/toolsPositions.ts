/**
 * 「我的持仓」工具（`/api/positions`）—— 与前端「持仓管理」页同源（service SQLite `positions` 表）。
 *
 * 注意别和实时页的**推导持仓**搞混：这里是用户手工录入的持仓（`/api/positions`），
 * 实时页那份是由已结算交易推导出来的（见 `toolsPortfolio` 的 `get_portfolio`）。
 *
 * 写操作都是 `readOnly: false` → 走确认令牌。
 */
import { z } from 'zod'
import { defineAgentTool } from './types.js'
import { resolveFund } from './fundLookup.js'
import { addPosition, listPositions, removePosition, updatePosition } from '../services/userDataService.js'

const fundCode = z.string().regex(/^\d{6}$/).describe('6 位基金代码')

export const positionTools = [
  defineAgentTool({
    name: 'get_positions',
    label: '读取持仓',
    description:
      '读取用户在「持仓管理」里录入的实际持仓（基金代码、份额、成本、买入日期），用于持仓诊断与收益核对。'
      + '这是**手工录入**的持仓；实时页那份由已结算交易推导的持仓见 `get_portfolio`。',
    promptSnippet: 'get_positions(): 用户手工录入的持仓列表',
    params: z.object({}),
    readOnly: true,
    handler: async () => ({ positions: listPositions() }),
  }),

  defineAgentTool({
    name: 'add_position',
    label: '新增持仓',
    description:
      '新增一条持仓记录（写 service SQLite，前端「持仓管理」页可见）。份额 share 与成本价 cost 都是必填；'
      + '基金名称不填会自动补全。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，'
      + '必须先把要记的持仓给用户看过并取得同意，再带上 __confirm_token 重调。',
    promptSnippet: 'add_position(fund_code, shares, cost, purchase_date?): 新增持仓（需确认）',
    params: z.object({
      fund_code: fundCode,
      shares: z.number().positive().describe('持有份额'),
      cost: z.number().positive().describe('成本单价（每份成本，元）'),
      fund_name: z.string().optional().describe('基金名称（不填则自动补全）'),
      purchase_date: z.string().optional().describe('买入日期 YYYY-MM-DD'),
      purchase_time: z.string().optional().describe('买入时间 HH:MM'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, fund_code, fund_name, ...rest } = args
      const resolved = fund_name ? { fundName: fund_name } : await resolveFund(fund_code)
      return {
        saved: addPosition({
          fundCode: fund_code,
          fundName: resolved.fundName,
          shares: rest.shares,
          cost: rest.cost,
          purchaseDate: rest.purchase_date ?? null,
          purchaseTime: rest.purchase_time ?? null,
        }),
        positions: listPositions(),
      }
    },
  }),

  defineAgentTool({
    name: 'update_position',
    label: '修改持仓',
    description:
      '修改一条持仓记录（只改传入的字段，其余不动）。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，'
      + '取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'update_position(id, shares?, cost?, fund_name?, purchase_date?): 修改持仓（需确认）',
    params: z.object({
      id: z.number().int().positive().describe('持仓 id（来自 get_positions）'),
      shares: z.number().positive().optional().describe('新的持有份额'),
      cost: z.number().positive().optional().describe('新的成本单价'),
      fund_name: z.string().optional().describe('基金名称'),
      purchase_date: z.string().nullable().optional().describe('买入日期 YYYY-MM-DD（null 清空）'),
      purchase_time: z.string().nullable().optional().describe('买入时间 HH:MM（null 清空）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id, fund_name, purchase_date, purchase_time, ...rest } = args
      const patch = {
        ...(rest.shares !== undefined ? { shares: rest.shares } : {}),
        ...(rest.cost !== undefined ? { cost: rest.cost } : {}),
        ...(fund_name !== undefined ? { fundName: fund_name } : {}),
        ...(purchase_date !== undefined ? { purchaseDate: purchase_date } : {}),
        ...(purchase_time !== undefined ? { purchaseTime: purchase_time } : {}),
      }
      if (Object.keys(patch).length === 0) return { error: '至少要提供一个要修改的字段' }
      if (!listPositions().some((position) => position.id === id)) {
        return { error: `持仓 ${id} 不存在（用 get_positions 查 id）` }
      }
      updatePosition(id, patch)
      return { positions: listPositions() }
    },
  }),

  defineAgentTool({
    name: 'delete_position',
    label: '删除持仓',
    description:
      '删除一条持仓记录（破坏性写入，前端「持仓管理」页同步消失）。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'delete_position(id): 删除持仓（需用户确认）',
    params: z.object({
      id: z.number().int().positive().describe('持仓 id（来自 get_positions）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id } = args
      const target = listPositions().find((position) => position.id === id)
      if (!target) return { error: `持仓 ${id} 不存在（用 get_positions 查 id）` }
      removePosition(id)
      return { deleted: { id, fund_code: target.fundCode }, positions: listPositions() }
    },
  }),
]
