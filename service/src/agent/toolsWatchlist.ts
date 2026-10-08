/**
 * 自选（watchlist）工具 —— 前端「我的自选」页的数据，真源是 service SQLite（`watchlist` 表）。
 *
 * 写操作（加/删）都属**写入类**：第一次调用只回 CONFIRM_REQUIRED + 令牌（见 `agent/confirm.ts`）。
 */
import { z } from 'zod'
import { defineAgentTool } from './types.js'
import { resolveFund } from './fundLookup.js'
import {
  listWatchlist,
  listWatchlistGroups,
  removeWatchlistItems,
  upsertWatchlistItem,
  type WatchlistItem,
} from '../services/userDataService.js'

const fundCode = z.string().regex(/^\d{6}$/).describe('6 位基金代码')

export const watchlistTools = [
  defineAgentTool({
    name: 'get_watchlist',
    label: '读取自选',
    description:
      '读取用户的自选基金列表与分组（service SQLite，前端「我的自选」页同源）。'
      + '返回 items（fundCode/fundName/fundType/groupId/sortOrder）与 groups。',
    promptSnippet: 'get_watchlist(): 用户自选基金与分组',
    params: z.object({}),
    readOnly: true,
    handler: async () => ({ items: listWatchlist(), groups: listWatchlistGroups() }),
  }),

  defineAgentTool({
    name: 'add_to_watchlist',
    label: '加入自选',
    description:
      '把一只基金加入用户自选（写 service SQLite，前端「我的自选」页可见；已存在则更新名称/分组）。'
      + '**这是写操作，会改用户的真实自选**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，'
      + '必须先把要加的基金给用户看过并取得同意，再带上 __confirm_token 重调。',
    promptSnippet: 'add_to_watchlist(fund_code, group_id?): 加入自选（需用户确认）',
    params: z.object({
      fund_code: fundCode,
      group_id: z.number().int().positive().optional().describe('自选分组 id（来自 get_watchlist）；不填则未分组'),
      fund_name: z.string().optional().describe('基金名称（不填则自动从数据源补全）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, fund_code, group_id, fund_name } = args
      const resolved = fund_name ? { fundName: fund_name, fundType: null } : await resolveFund(fund_code)
      const item: WatchlistItem = {
        fundCode: fund_code,
        fundName: resolved.fundName,
        fundType: resolved.fundType,
        groupId: group_id ?? null,
        sortOrder: Date.now(),
        addedAt: Date.now(),
      }
      return { saved: upsertWatchlistItem(item), items: listWatchlist() }
    },
  }),

  defineAgentTool({
    name: 'remove_from_watchlist',
    label: '移出自选',
    description:
      '把一只或多只基金移出用户自选（破坏性写入，前端「我的自选」页同步消失）。'
      + '**这是写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'remove_from_watchlist(fund_codes): 移出自选（需用户确认）',
    params: z.object({
      fund_codes: z.array(fundCode).min(1).describe('要移出的基金代码列表'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, fund_codes } = args
      removeWatchlistItems(fund_codes)
      return { removed: fund_codes, items: listWatchlist() }
    },
  }),
]
