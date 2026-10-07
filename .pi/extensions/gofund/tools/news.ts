/**
 * News tools (read-only).
 *
 * `GET /api/news/flash?count=&page=` — the frontend's `get_market_news` and
 * `get_flash_news` both hit this one endpoint, so a single tool provides both.
 */

import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { apiGetData, clampInt, jsonResult } from '../client.ts'

export const newsTools = [
  defineTool({
    name: 'get_flash_news',
    label: '获取快讯新闻',
    description: '获取市场 7×24 快讯（多数据源合并去重后的今日实时消息）。',
    promptSnippet: 'get_flash_news(count?): 今日 7×24 快讯',
    parameters: Type.Object({
      count: Type.Optional(Type.Integer({ description: '新闻条数，默认 20，最大 300' })),
    }),
    async execute(_toolCallId, params) {
      const count = clampInt(params.count, 20, 1, 300)
      const data = await apiGetData('/api/news/flash', { count, page: 1 })
      return jsonResult(data, '/api/news/flash')
    },
  }),
]
