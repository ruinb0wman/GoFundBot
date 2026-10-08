/**
 * 自选（watchlist）工具 —— 前端「我的自选」页的数据，真源是 service SQLite（`watchlist` 表）。
 *
 * 写操作（加/删）都属**写入类**：第一次调用只回 CONFIRM_REQUIRED + 令牌（见 `agent/confirm.ts`）。
 */
import { z } from 'zod'
import { defineAgentTool } from './types.js'
import { resolveFund } from './fundLookup.js'
import {
  assignWatchlistGroup,
  createWatchlistGroup,
  deleteWatchlistGroup,
  listWatchlist,
  listWatchlistGroups,
  removeWatchlistItems,
  renameWatchlistGroup,
  reorderWatchlist,
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
      if (group_id !== undefined && !listWatchlistGroups().some((group) => group.id === group_id)) {
        return { error: `分组 ${group_id} 不存在（用 get_watchlist 查 groups）` }
      }
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

  defineAgentTool({
    name: 'save_watchlist_group',
    label: '新建/重命名自选分组',
    description:
      '新建一个自选分组，或重命名已有的（写 service SQLite，前端「我的自选」页可见）。'
      + '不传 id = 新建（需 name）；传 id = 重命名。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'save_watchlist_group(name, id?): 新建/重命名自选分组（需确认）',
    params: z.object({
      id: z.number().int().positive().optional().describe('要重命名的分组 id（来自 get_watchlist）；不填则新建'),
      name: z.string().min(1).max(30).describe('分组名'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id, name } = args
      if (id) {
        if (!listWatchlistGroups().some((group) => group.id === id)) {
          return { error: `分组 ${id} 不存在（用 get_watchlist 查 groups）` }
        }
        renameWatchlistGroup(id, name)
      } else {
        createWatchlistGroup(name)
      }
      return { groups: listWatchlistGroups() }
    },
  }),

  defineAgentTool({
    name: 'delete_watchlist_group',
    label: '删除自选分组',
    description:
      '删除一个自选分组（组内基金回到「未分组」，不会被删掉）。'
      + '**破坏性写入**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'delete_watchlist_group(id): 删除自选分组（需用户确认）',
    params: z.object({
      id: z.number().int().positive().describe('要删除的分组 id（来自 get_watchlist）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id } = args
      const target = listWatchlistGroups().find((group) => group.id === id)
      if (!target) return { error: `分组 ${id} 不存在（用 get_watchlist 查 groups）` }
      deleteWatchlistGroup(id)
      return { deleted: { id, name: target.name }, groups: listWatchlistGroups(), items: listWatchlist() }
    },
  }),

  defineAgentTool({
    name: 'assign_watchlist_group',
    label: '自选基金分组',
    description:
      '把一批自选基金移到某个分组（`group_id` 传 null = 取消分组）。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'assign_watchlist_group(fund_codes, group_id?): 自选基金分组（需确认）',
    params: z.object({
      fund_codes: z.array(fundCode).min(1).describe('要分组的自选基金代码'),
      group_id: z.number().int().positive().nullable().optional().describe('目标分组 id；null / 不填 = 取消分组'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, fund_codes, group_id } = args
      const target = group_id ?? null
      if (target !== null && !listWatchlistGroups().some((group) => group.id === target)) {
        return { error: `分组 ${target} 不存在（用 get_watchlist 查 groups）` }
      }
      assignWatchlistGroup(fund_codes, target)
      return { items: listWatchlist(), groups: listWatchlistGroups() }
    },
  }),

  defineAgentTool({
    name: 'reorder_watchlist',
    label: '自选排序',
    description:
      '按给定顺序重排自选列表（传入的代码顺序就是新的显示顺序；未列出的基金排在后面）。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'reorder_watchlist(fund_codes): 自选排序（需确认）',
    params: z.object({
      fund_codes: z.array(fundCode).min(1).describe('新的顺序（代码列表）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, fund_codes } = args
      reorderWatchlist(fund_codes)
      return { items: listWatchlist() }
    },
  }),
]
