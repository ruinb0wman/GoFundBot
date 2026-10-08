/**
 * 工具侧的小工具：给一个基金代码，尽量补全名称/类型（eastmoney，带 24h 缓存）。
 * 取不到就返回 null —— 调用方（自选/告警/组合）不该因为「名字查不到」而失败。
 */
import { getFundBasic } from '../services/fundService.js'

export interface ResolvedFund {
  fundName: string | null
  fundType: string | null
}

export async function resolveFund(code: string): Promise<ResolvedFund> {
  try {
    const basic = await getFundBasic(code)
    return { fundName: basic.data?.name ?? null, fundType: basic.data?.type ?? null }
  } catch {
    return { fundName: null, fundType: null }
  }
}
