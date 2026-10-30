<template>
  <div class="backtest-workspace">
    <div class="workspace-top">
      <BacktestScriptList
        :scripts="scripts"
        :current-id="currentId"
        @select="select"
        @create="newScript"
        @duplicate="duplicate"
        @remove="remove"
      />
    </div>

    <section class="workbench">
      <div class="workbench-head">
        <input v-model="name" class="name-input" placeholder="方案名称" maxlength="40" />

        <div class="tabs">
          <button class="tab" :class="{ active: toolTab === 'edit' }" @click="toolTab = 'edit'">{{ '编辑' }}</button>
          <button class="tab" :class="{ active: toolTab === 'result' }" @click="toolTab = 'result'">{{ '结果' }}</button>
        </div>

        <div class="head-actions">
          <select class="template-select" value="" @change="onTemplateChange">
            <option value="" disabled>{{ '插入模板…' }}</option>
            <option v-for="tpl in templates" :key="tpl.key" :value="tpl.key">{{ tpl.label }}</option>
          </select>
          <RButton size="small" plain @click="save">{{ '保存' }}</RButton>
          <RButton size="small" plain @click="saveAs">{{ '另存为' }}</RButton>
          <RButton size="small" type="primary" :disabled="running" @click="runTest">
            {{ running ? '运行中…' : '运行回测' }}
          </RButton>
        </div>
      </div>

      <div v-if="error" class="error-message">{{ error }}</div>

      <div v-if="toolTab === 'edit'" class="edit-pane">
        <div class="editor-hint">
          {{ 'prepare(sdk) 里用 assets 声明固定池（CASH 表示现金腿），onDay(s) 按基金代码决策：{ buy?: [{code, amount}], sell?, rebalance?: {code: 权重}, sellAll? }。' }}
        </div>
        <div class="editor-wrap">
          <CodeEditor :model-value="code" @update:model-value="code = $event" />
        </div>
      </div>

      <div v-else class="result-pane">
        <BacktestResultPanel v-if="outcome" :result="outcome.result" />
        <div v-else class="result-empty">{{ '还没有结果，先在「编辑」里点「运行回测」。' }}</div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { RButton, RLucideIcon } from '@ruinb0w/ui'
import { useBacktestWorkspace } from '../composables/useBacktestWorkspace'
import CodeEditor from '../components/backtest/CodeEditor.vue'
import BacktestScriptList from '../components/backtest/BacktestScriptList.vue'
import BacktestResultPanel from '../components/backtest/BacktestResultPanel.vue'
import { STRATEGY_TEMPLATES, type StrategyTemplate } from '@gofund/core/backtest/strategyTemplates'

defineOptions({ name: 'BacktestView' })

const route = useRoute()
const initialFundCode = String(route.params.code || '')

const {
  scripts,
  currentId,
  name,
  code,
  running,
  error,
  outcome,
  toolTab,
  select,
  newScript,
  applyTemplate,
  save,
  saveAs,
  duplicate,
  remove,
  runTest,
} = useBacktestWorkspace(initialFundCode)

const templates = computed(() => STRATEGY_TEMPLATES)

function onTemplateChange(event: Event) {
  const selectEl = event.target as HTMLSelectElement
  const template = templates.value.find((t) => t.key === selectEl.value) as StrategyTemplate | undefined
  if (template) applyTemplate(template)
  selectEl.value = ''
}
</script>

<style scoped>
.backtest-workspace {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: calc(100vh - 140px);
  min-height: 560px;
}

.workspace-top {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 12px;
  flex: 1 1 45%;
  min-height: 260px;
}

.chat-panel-wrap {
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  overflow: hidden;
}

.workbench {
  flex: 1 1 55%;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 12px;
  overflow: auto;
}

.workbench-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.name-input {
  flex: 1;
  min-width: 160px;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.tabs {
  display: inline-flex;
  gap: 4px;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-hover);
}

.tab {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.tab.active {
  background: var(--bg-card);
  color: var(--text-primary);
  font-weight: 600;
}

.head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.template-select {
  padding: 5px 8px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 12px;
}

.llm-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-primary);
  border-radius: 8px;
  background: rgba(22, 119, 255, 0.08);
  font-size: 12px;
}

.error-message {
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(255, 77, 79, 0.12);
  color: var(--color-danger);
  font-size: 12px;
}

.edit-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.editor-hint {
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.editor-wrap {
  border: 1px solid var(--border-default);
  border-radius: 8px;
  overflow: hidden;
}

.result-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
}

@media (max-width: 900px) {
  .workspace-top {
    grid-template-columns: minmax(0, 1fr);
  }
  /* 工作台占满「视口 - 头部 - 底栏」，页面本身不滚（否则整页一滚，搜索行和底栏就离开屏幕遮挡内容）。
   * 两个高度变量在 App.css 的 ≤768 块里定，改头部/底栏时要同步。 */
  .backtest-workspace {
    height: calc(
      100dvh - var(--app-header-h, 0px) - var(--app-tabbar-h, 0px) - 24px - env(safe-area-inset-bottom, 0px)
    );
    min-height: 0;
  }
  /* 方案列表按内容定高（最多 40%），剩下的给编辑器；两边各自内部滚 */
  .workspace-top { flex: 0 0 auto; min-height: 96px; max-height: 32%; }
  .workbench { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .edit-pane { flex: 1; min-height: 0; }
  .editor-wrap { flex: 1; height: auto; min-height: 180px; }
}
</style>
