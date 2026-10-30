<template>
  <div class="settings-pi">
    <section class="setting-section">
      <h3>AI 在终端 pi 里</h3>
      <p class="section-desc">
        App 不接 LLM、不存任何密钥 —— 页面只做展示与计算，分析和对话发生在终端
        <code>pi</code>。它通过 service 的工具面读写本应用的数据，下面是它手上的工具与技能。
      </p>
    </section>

    <section class="setting-section">
      <h3>怎么开始</h3>
      <pre class="cmd-block"><code># 终端 A —— service（工具面的真源，必须起着）
cd service && bun run dev

# 终端 B —— 仓库根目录
pi          # 首次会问 project trust，信任后才会加载本仓库的扩展与技能</code></pre>
      <p class="section-desc">
        然后直接说人话，例如「今天大盘怎么样，前 5 个热门板块」「比较一下 000001 和 110022 近三年定投」。
      </p>
    </section>

    <section class="setting-section">
      <h3>
        工具面
        <span v-if="count !== null" class="count-badge">{{ count }} 个{{ destructive.length ? ` · ${destructive.length} 个需确认` : '' }}</span>
      </h3>
      <p class="section-desc">
        清单由 service 提供（<code>GET /api/agent/tools</code>），扩展
        <code>.pi/extensions/gofund/</code> 只是通用桥：拉起清单、逐个注册、调用走
        <code>POST /api/agent/call</code>。所以这里显示的就是 pi 手上真实的工具。
      </p>
      <p v-if="loadError" class="fallback-note">
        {{ loadError }} —— 工具清单暂时不可用（工具仍会注册，只是列不出来）。
      </p>
      <ul v-else-if="tools.length" class="tool-list">
        <li v-for="tool in tools" :key="tool.name" class="tool-item" :title="tool.description">
          <code class="tool-name">{{ tool.name }}</code>
          <span class="tool-label">{{ tool.label }}</span>
          <span class="tool-flag" :class="tool.readOnly ? 'readonly' : 'confirm'">
            {{ tool.readOnly ? '只读' : '需确认' }}
          </span>
        </li>
      </ul>
      <p v-else class="section-desc">加载中…</p>
    </section>

    <section class="setting-section">
      <h3>技能（Skills）</h3>
      <p class="section-desc">
        技能是「套路与口径」，工具才是执行 —— 技能告诉 pi 什么场景用哪些工具、结果怎么读、哪些数不能当 0。
      </p>
      <table class="info-table">
        <thead>
          <tr><th>技能</th><th>触发</th><th>干什么</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>gofund-data</code></td>
            <td>问到行情 / 板块 / 资金 / 某只基金 / 净值 / 持仓 / 快讯 / 定投回测 / 4433 筛选</td>
            <td>组合套路（先定基调再看结构）、口径陷阱（北向净流入恒 null、涨跌停可能 null、估值分位不是买卖信号）</td>
          </tr>
          <tr>
            <td><code>gofund-strategy</code></td>
            <td>「我的策略」「改进我的定投策略」「打开策略页面」</td>
            <td>先读真实策略再改进，改完用 bow 浏览器打开 <code>/strategy</code> 给你看</td>
          </tr>
        </tbody>
      </table>
      <p class="section-desc">
        位置 <code>.pi/skills/</code>；工具定义与口径的唯一真源仍在 <code>service/src/agent/</code>。
      </p>
    </section>

    <section class="setting-section">
      <h3>写操作要确认</h3>
      <ol class="flow-list">
        <li>pi 第一次调用写/执行类工具（自选、告警、组合、持仓、策略、回测方案、策略代码）时，<strong>不会真的改数据</strong>，只拿回一个确认令牌。</li>
        <li>它必须把要写入 / 要执行的完整内容展示给你，拿到明确同意。</li>
        <li>用<strong>完全相同的参数</strong> + 令牌重调才落库。令牌一次性、10 分钟过期，参数改一个字就失效、重新要确认。</li>
      </ol>
    </section>

    <section class="setting-section">
      <h3>更多</h3>
      <ul class="link-list">
        <li>
          <a class="doc-link" href="/docs/architecture/pi-tools" target="_blank"
             @click="openDocLink($event, '/docs/architecture/pi-tools')">pi 工具面</a>
          —— 完整工具分组、确认流程、降级行为
        </li>
        <li>
          <a class="doc-link" href="/docs/architecture/node-core" target="_blank"
             @click="openDocLink($event, '/docs/architecture/node-core')">node-core 架构</a>
          —— 分层、存储、数据流
        </li>
        <li>
          <a class="doc-link" href="/docs/architecture/data-flow" target="_blank"
             @click="openDocLink($event, '/docs/architecture/data-flow')">数据流</a>
          —— 一次提问的数据是怎么走到你的
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../services/api'
import { openDocLink } from '../services/docLink'

interface AgentToolItem {
  name: string
  label: string
  description: string
  readOnly: boolean
}

const tools = ref<AgentToolItem[]>([])
const destructive = ref<string[]>([])
const count = ref<number | null>(null)
const loadError = ref('')

onMounted(async () => {
  try {
    const res = await api.get<{ data: { tools: AgentToolItem[]; count: number; destructive: string[] } }>(
      '/agent/tools',
      { timeoutMs: 4000 },
    )
    const payload = res.data?.data
    tools.value = payload?.tools ?? []
    destructive.value = payload?.destructive ?? []
    count.value = payload?.count ?? tools.value.length
  } catch {
    loadError.value = '连不上 service（默认 http://localhost:8310）'
  }
})
</script>

<style scoped>
.settings-pi {
  padding: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
}

.setting-section {
  margin-bottom: 32px;
}

.setting-section:last-child {
  margin-bottom: 0;
}

.setting-section h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.section-desc {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-tertiary);
}

.section-desc code,
.info-table code,
.link-list code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-subtle);
  font-size: 12px;
  color: var(--text-primary);
}

.count-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-subtle);
  font-size: 12px;
  font-weight: 400;
  color: var(--text-tertiary);
}

.cmd-block {
  margin: 0 0 12px;
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-subtle);
  font-size: 12.5px;
  line-height: 1.7;
  overflow-x: auto;
}

.fallback-note {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-subtle);
  font-size: 13px;
  color: var(--text-tertiary);
}

.tool-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-subtle);
  min-width: 0;
}

.tool-name {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-label {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-flag {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
}

.tool-flag.readonly {
  background: var(--bg-card);
  color: var(--text-tertiary);
}

.tool-flag.confirm {
  background: var(--color-primary);
  color: var(--text-inverse);
}

.info-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.info-table th,
.info-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-default);
  text-align: left;
  vertical-align: top;
}

.info-table th {
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.info-table td {
  color: var(--text-tertiary);
  line-height: 1.6;
}

.flow-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-tertiary);
}

.flow-list strong {
  color: var(--text-primary);
}

.link-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--text-tertiary);
}

.doc-link {
  color: var(--color-primary);
  text-decoration: none;
}

.doc-link:hover {
  text-decoration: underline;
}
</style>
