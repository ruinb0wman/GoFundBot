/**
 * Backtest workspace state: saved-scheme CRUD, run orchestration and the chat → editor
 * bridge. Kept out of the view so `BacktestView.vue` stays layout-only.
 *
 * A scheme is just code: `prepare()` declares the pool/window/amounts, `onDay()` decides.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useChatStore } from '../stores/chatStore'
import {
  createStrategyScript,
  deleteStrategyScript,
  duplicateStrategyScript,
  getStrategyScript,
  listStrategyScripts,
  recordScriptRun,
  updateStrategyScript,
  type StrategyScriptRecord,
} from '../db/strategyScripts'
import { runScript, type ScriptRunOutcome } from '../services/backtest/scriptRun'
import { DEFAULT_STRATEGY_CODE, type StrategyTemplate } from '../services/backtest/strategyTemplates'

/** Deep link `/backtest/:code` starts from a one-fund scheme. */
function fundStarterCode(fundCode: string): string {
  return `function prepare(sdk) {
  return { assets: ['${fundCode}'] };
}

function onDay(s) {
  // 每月 1 号买入 1000 元（若 1 号休市则该月不买）
  if (s.date.slice(8) === '01') return { buy: [{ code: '${fundCode}', amount: 1000 }] };
  return {};
}`
}

export function useBacktestWorkspace(initialFundCode = '') {
  const chatStore = useChatStore()

  const scripts = ref<StrategyScriptRecord[]>([])
  const currentId = ref<number | null>(null)
  const name = ref('未命名方案')
  const code = ref(initialFundCode ? fundStarterCode(initialFundCode) : DEFAULT_STRATEGY_CODE)

  const running = ref(false)
  const error = ref('')
  const outcome = ref<Extract<ScriptRunOutcome, { result: unknown }> | null>(null)
  const toolTab = ref<'edit' | 'result'>('edit')

  function applyRecord(record: StrategyScriptRecord) {
    currentId.value = record.id ?? null
    name.value = record.name
    code.value = record.code
    outcome.value = null
    error.value = ''
    toolTab.value = 'edit'
  }

  async function refresh() {
    scripts.value = await listStrategyScripts()
  }

  async function select(id: number) {
    if (currentId.value === id) return
    const record = await getStrategyScript(id)
    if (record) applyRecord(record)
  }

  function newScript() {
    currentId.value = null
    name.value = '未命名方案'
    code.value = initialFundCode ? fundStarterCode(initialFundCode) : DEFAULT_STRATEGY_CODE
    outcome.value = null
    error.value = ''
    toolTab.value = 'edit'
  }

  function applyTemplate(template: StrategyTemplate) {
    code.value = template.code
    outcome.value = null
  }

  async function save(): Promise<void> {
    const input = { name: name.value, code: code.value }
    if (currentId.value == null) currentId.value = await createStrategyScript(input)
    else await updateStrategyScript(currentId.value, input)
    await refresh()
  }

  async function saveAs(): Promise<void> {
    currentId.value = await createStrategyScript({ name: `${name.value || '未命名方案'} 副本`, code: code.value })
    await refresh()
  }

  async function duplicate(id: number) {
    const newId = await duplicateStrategyScript(id)
    await refresh()
    if (newId != null) await select(newId)
  }

  async function remove(id: number) {
    await deleteStrategyScript(id)
    if (currentId.value === id) newScript()
    await refresh()
  }

  async function runTest() {
    running.value = true
    error.value = ''
    try {
      const result = await runScript(code.value)
      if ('error' in result) {
        error.value = result.error
        return
      }
      outcome.value = result
      toolTab.value = 'result'
      if (currentId.value != null) {
        await recordScriptRun(currentId.value, result.result.summary)
        await refresh()
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      running.value = false
    }
  }

  // ── chat → editor bridge ──────────────────────────────────────────────────────
  const llmParams = ref<Record<string, unknown> | null>(null)

  function scanLlmCalls() {
    const calls = [...chatStore.messages.flatMap((message) => message.toolCalls ?? []), ...chatStore.activeToolCalls]
    for (let i = calls.length - 1; i >= 0; i -= 1) {
      const call = calls[i]
      const params = call.params as { code?: unknown } | undefined
      if (
        (call.name === 'run_strategy_code' || call.name === 'save_strategy_script') &&
        typeof params?.code === 'string' &&
        params.code.trim()
      ) {
        llmParams.value = { ...call.params }
        return
      }
    }
  }

  watch(() => [chatStore.messages.length, chatStore.activeToolCalls.length], scanLlmCalls)

  function loadLlmSuggestion() {
    if (!llmParams.value) return
    name.value = String(llmParams.value.name ?? llmParams.value.script_name ?? 'AI 策略')
    code.value = String(llmParams.value.code ?? '')
    outcome.value = null
    toolTab.value = 'edit'
  }

  function dismissLlmSuggestion() {
    llmParams.value = null
  }

  const currentRecord = computed(() => scripts.value.find((script) => script.id === currentId.value) ?? null)

  onMounted(async () => {
    await refresh()
    if (initialFundCode) return // keep the deep-link starter code
    if (scripts.value.length > 0) await select(scripts.value[0].id as number)
  })

  return {
    scripts,
    currentId,
    currentRecord,
    name,
    code,
    running,
    error,
    outcome,
    toolTab,
    llmParams,
    refresh,
    select,
    newScript,
    applyTemplate,
    save,
    saveAs,
    duplicate,
    remove,
    runTest,
    loadLlmSuggestion,
    dismissLlmSuggestion,
  }
}
