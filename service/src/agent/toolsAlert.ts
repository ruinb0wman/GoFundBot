/**
 * 告警工具（`/api/alerts`）—— 真源在 service SQLite（迁移 005），与前端
 * `AlertSettings.vue` / `AlertBadge.vue` / `SettingsAnomalyThreshold.vue` 同源。
 *
 * 写操作（`save_alert` / `delete_alert` / `save_anomaly_config`）都是 `readOnly: false` → 走确认令牌。
 */
import { z } from 'zod'
import { defineAgentTool } from './types.js'
import { resolveFund } from './fundLookup.js'
import {
  checkAlerts,
  createAlert,
  detectMarketAnomalies,
  getAnomalyConfig,
  listAlerts,
  removeAlert,
  saveAnomalyConfig,
  updateAlert,
  type AnomalyConfig,
} from '../services/alertService.js'

const alertType = z
  .enum(['price_up', 'price_down', 'return_above', 'return_below'])
  .describe(
    'price_up 涨超 / price_down 跌超（按实时估算涨跌幅）· return_above 收益大于 / return_below 收益小于（按持仓收益率）'
  )

const threshold = z.number().positive().describe('阈值，百分数（5 = 5%）。price_down 用正数表示跌幅（3 = 跌超 3%）')

export const alertTools = [
  defineAgentTool({
    name: 'get_alerts',
    label: '读取告警规则',
    description:
      '读取用户的基金告警规则（fund_code/alert_type/threshold/enabled/last_triggered）与市场异动阈值配置。'
      + '`price_*` 比的是实时估算涨跌幅，`return_*` 比的是**持仓收益率**（持仓由已结算交易推导，没持仓的基金不会触发）。',
    promptSnippet: 'get_alerts(): 告警规则 + 异动阈值',
    params: z.object({}),
    readOnly: true,
    handler: async () => ({ rules: listAlerts(), anomaly_config: getAnomalyConfig() }),
  }),

  defineAgentTool({
    name: 'save_alert',
    label: '保存告警规则',
    description:
      '新建或更新一条基金告警规则（写 service SQLite，前端「告警设置」里可见）。'
      + '不传 id = 新建（需要 fund_code + alert_type）；传 id = 更新（改 threshold / enabled）。'
      + '**这是写操作，会改用户的真实告警**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，'
      + '必须先把要写的规则给用户看过并取得同意，再带上 __confirm_token 重调。',
    promptSnippet: 'save_alert(fund_code, alert_type, threshold, id?, enabled?): 新建/更新告警（需确认）',
    params: z.object({
      id: z.number().int().positive().optional().describe('要更新的规则 id（来自 get_alerts）；不填则新建'),
      fund_code: z.string().regex(/^\d{6}$/).optional().describe('基金代码（新建时必填，更新时忽略）'),
      alert_type: alertType.optional().describe('告警类型（新建时必填，更新时忽略）'),
      threshold,
      enabled: z.boolean().optional().describe('是否启用（更新时用；新建默认启用）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, ...rest } = args
      if (rest.id) {
        const updated = updateAlert(rest.id, {
          threshold: rest.threshold,
          enabled: rest.enabled === undefined ? undefined : rest.enabled ? 1 : 0,
        })
        if (!updated) return { error: `告警规则 ${rest.id} 不存在（用 get_alerts 查 id）` }
        return { saved: updated, rules: listAlerts() }
      }
      if (!rest.fund_code || !rest.alert_type) {
        return { error: '新建告警需要 fund_code 与 alert_type（要更新已有规则请传 id）' }
      }
      const { fundName } = await resolveFund(rest.fund_code)
      return {
        saved: createAlert({
          fund_code: rest.fund_code,
          alert_type: rest.alert_type,
          threshold: rest.threshold,
          fund_name: fundName,
        }),
        rules: listAlerts(),
      }
    },
  }),

  defineAgentTool({
    name: 'delete_alert',
    label: '删除告警规则',
    description:
      '删除一条基金告警规则（破坏性写入，前端「告警设置」里同步消失）。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'delete_alert(id): 删除告警规则（需用户确认）',
    params: z.object({
      id: z.number().int().positive().describe('要删除的规则 id（来自 get_alerts）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id } = args
      const target = listAlerts().find((rule) => rule.id === id)
      if (!target) return { error: `告警规则 ${id} 不存在（用 get_alerts 查 id）` }
      removeAlert(id)
      return { deleted: { id, fund_code: target.fund_code, alert_type: target.alert_type }, rules: listAlerts() }
    },
  }),

  defineAgentTool({
    name: 'check_alerts',
    label: '立即检查告警',
    description:
      '立刻评估一遍所有启用的告警规则，返回命中的规则（含当前值与阈值）。'
      + '**副作用**：命中的规则会写 last_triggered 并进入 **6 小时冷却**（冷却期内不再重复报）—— 这是通知去抖，不是数据修改。',
    promptSnippet: 'check_alerts(): 立即评估告警规则（命中后 6h 冷却）',
    params: z.object({}),
    readOnly: true,
    handler: async () => checkAlerts(),
  }),

  defineAgentTool({
    name: 'get_market_anomaly',
    label: '市场异动',
    description:
      '按当前异动阈值检测当日市场异动：指数大涨/大跌、板块大涨/大跌、两市成交额放量/缩量。'
      + '返回 anomalies（type/name/value）、indices 行情与当前阈值。'
      + '注意：`north_*` 阈值没有数据可判（北向净流入自 2024-08 起停止披露）。',
    promptSnippet: 'get_market_anomaly(): 当日市场异动（指数/板块/成交额）',
    params: z.object({}),
    readOnly: true,
    async handler() {
      const detected = await detectMarketAnomalies()
      return { ...detected, config: getAnomalyConfig() }
    },
  }),

  defineAgentTool({
    name: 'save_anomaly_config',
    label: '保存异动阈值',
    description:
      '更新市场异动的判定阈值（前端「设置 → 异动阈值」同一份配置，落 SQLite）。只传要改的字段，其余保持不动。'
      + '**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'save_anomaly_config(index_surge_threshold?, …): 改异动阈值（需确认）',
    params: z.object({
      index_surge_threshold: z.number().optional().describe('指数大涨阈值（%，默认 3）'),
      index_plunge_threshold: z.number().optional().describe('指数大跌阈值（%，默认 -3）'),
      volume_surge_ratio: z.number().optional().describe('成交额放量倍数（默认 1.5）'),
      volume_shrink_ratio: z.number().optional().describe('成交额缩量倍数（默认 0.5）'),
      sector_surge_threshold: z.number().optional().describe('板块大涨阈值（%，默认 5）'),
      sector_plunge_threshold: z.number().optional().describe('板块大跌阈值（%，默认 -5）'),
      sector_inflow_threshold: z.number().optional().describe('板块主力净流入阈值（亿元，默认 10）'),
      north_inflow_threshold: z.number().optional().describe('北向流入阈值（暂无数据可判）'),
      north_outflow_threshold: z.number().optional().describe('北向流出阈值（暂无数据可判）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, ...rest } = args
      const patch = Object.fromEntries(
        Object.entries(rest).filter(([, value]) => typeof value === 'number')
      ) as Partial<AnomalyConfig>
      if (Object.keys(patch).length === 0) return { error: '至少要提供一个阈值字段' }
      return { config: saveAnomalyConfig(patch), note: '阈值已保存，与前端「设置 → 异动阈值」是同一份配置。' }
    },
  }),
]
