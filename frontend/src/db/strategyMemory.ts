/**
 * 策略记忆。
 *
 * Node 核心化（P2）后策略存在 service 的 SQLite（`strategies` 表）；
 * 本模块保留原导出签名，内部转发到 `services/userDataApi.ts`。
 * 现已在「策略记忆文件夹」版：后端把每条策略落成配置目录里的一个 markdown 文件
 * （前端无感知，仍是同一套 HTTP 接口 + `settingsAPI` 里的文件夹配置）。
 * 注：原来还有 `getActiveStrategies()` / `buildStrategyContext()`（把启用策略拼成注入提示词的文本），
 * 随前端 AI 删除而失去调用方，P6 一并删掉 —— 现在 pi 通过 `list_strategies` 工具读原始数据，
 * 页面只维护策略本身。
 *
 * 写入后派发 `gofund:strategies-changed`，`StrategyView` 监听并刷新
 * （写者无关：UI 表单与 HTTP 客户端都触发同一个信号）。
 */
import type { StrategyRecord } from '../types/records'
import { settingsAPI } from '../services/api'
import {
  addStrategyApi,
  listStrategiesApi,
  removeStrategyApi,
  updateStrategyApi,
  type StrategyInput,
} from '../services/userDataApi'

export type { StrategyInput }

/** Query all strategy entries (服务端已按「启用优先 + 更新时间倒序」返回). */
export async function listStrategies(): Promise<StrategyRecord[]> {
  return listStrategiesApi()
}

/** 策略文件夹绝对路径；空串 = 未配置（此时策略记忆为空）。 */
export async function fetchStrategyDir(): Promise<string> {
  const res = await settingsAPI.get()
  return String(res.data?.data?.strategy?.dir ?? '')
}

/** 保存策略文件夹（service 会建目录、校验可写，并把旧 SQLite 策略一次导出成 md）。 */
export async function saveStrategyDir(dir: string): Promise<string> {
  const res = await settingsAPI.update({ strategy: { dir } })
  notifyStrategiesChanged()
  return String(res.data?.data?.strategy?.dir ?? '')
}

export const STRATEGIES_CHANGED_EVENT = 'gofund:strategies-changed'

function notifyStrategiesChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STRATEGIES_CHANGED_EVENT))
}

export async function addStrategy(input: StrategyInput): Promise<number> {
  const created = await addStrategyApi({
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    active: input.active ?? 1,
    source: input.source ?? 'manual',
  })
  notifyStrategiesChanged()
  return created.id
}

export async function updateStrategy(id: number, patch: Partial<StrategyInput>): Promise<void> {
  await updateStrategyApi(id, patch)
  notifyStrategiesChanged()
}

export async function toggleStrategyActive(id: number, active: boolean): Promise<void> {
  await updateStrategy(id, { active: active ? 1 : 0 })
}

export async function removeStrategy(id: number): Promise<void> {
  await removeStrategyApi(id)
  notifyStrategiesChanged()
}
