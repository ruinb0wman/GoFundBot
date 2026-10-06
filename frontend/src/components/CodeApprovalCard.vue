<template>
  <div v-if="request" class="code-approval">
    <div class="code-approval-head">
      <LucideIcon name="Code2" :size="14" />
      <span class="code-approval-title">AI 想运行自定义策略代码</span>
    </div>
    <div class="code-approval-meta">
      <span v-if="scriptName">已保存方案：{{ scriptName }}</span>
      <span v-else>自定义策略</span>
      <span v-if="!scriptName">{{ request.params.start_date || 'prepare() 声明' }} ~ {{ request.params.end_date || '默认' }}</span>
    </div>
    <pre class="code-approval-code">{{ displayCode || '（未找到该方案的代码）' }}</pre>
    <div class="code-approval-actions">
      <BButton size="small" text @click="reject">{{ '取消' }}</BButton>
      <BButton size="small" type="primary" @click="approve">{{ '运行' }}</BButton>
    </div>
    <p class="code-approval-note">
      {{ '代码在本机浏览器沙箱中执行，只能读取 prepare() 声明的标的的本地缓存净值，最长 5 秒后自动终止。' }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BButton, LucideIcon } from '@gofund/ui'
import { toolApproval } from '../services/chatEngine/toolApproval'
import { findStrategyScriptsByName } from '../db/strategyScripts'

const request = computed(() => toolApproval.pending.value)

const scriptName = computed(() => {
  const value = request.value?.params?.script_name
  return typeof value === 'string' && value.trim() ? value : ''
})

/** `script_name` mode carries no inline code — load it from the saved scheme to show it. */
const savedCode = ref('')
watch(
  request,
  async (req) => {
    savedCode.value = ''
    const name = req?.params?.script_name
    if (typeof name !== 'string' || !name.trim()) return
    try {
      const found = await findStrategyScriptsByName(name)
      if (found.length === 1) savedCode.value = found[0].code
    } catch {
      savedCode.value = ''
    }
  },
  { immediate: true },
)

const displayCode = computed(() => {
  const inline = request.value?.params?.code
  return typeof inline === 'string' && inline.trim() ? inline : savedCode.value
})

function approve() {
  toolApproval.resolve(true)
}

function reject() {
  toolApproval.resolve(false)
}
</script>

<style scoped>
.code-approval {
  margin: 8px 0;
  padding: 12px;
  border: 1px solid var(--border-color, #3a3a3f);
  border-radius: 8px;
  background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
}

.code-approval-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.code-approval-meta {
  display: flex;
  gap: 10px;
  margin: 6px 0;
  font-size: 12px;
  opacity: 0.75;
}

.code-approval-code {
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border-radius: 6px;
  background: var(--bg-code, rgba(0, 0, 0, 0.28));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.code-approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.code-approval-note {
  margin: 8px 0 0;
  font-size: 11px;
  opacity: 0.6;
  line-height: 1.4;
}
</style>
