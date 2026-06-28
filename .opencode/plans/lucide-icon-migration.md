# Lucide Icon Migration Plan

> 将前端全部 emoji 图标替换为 `@lucide/vue` SVG 图标组件。
> 采用分阶段实施，每阶段完成后可独立验证，中断后可从此文档恢复。

---

## Phase 0: 基础设施 (1 文件新建 + 3 文件修改)

### 0.1 安装依赖
```bash
cd Frontend && npm install @lucide/vue
```

### 0.2 创建封装组件 `Frontend/src/components/LucideIcon.vue`
通过 `name` prop 动态选择 Lucide 组件，避免每个文件重复 import 几十个图标。

```vue
<script setup>
import { computed } from 'vue'
import * as icons from '@lucide/vue'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 20 },
  color: { type: String, default: 'currentColor' },
  strokeWidth: { type: [Number, String], default: 2 },
})

const icon = computed(() => icons[props.name] || null)
</script>

<template>
  <component
    v-if="icon"
    :is="icon"
    :size="size"
    :color="color"
    :stroke-width="strokeWidth"
  />
  <span v-else class="lucide-icon-fallback">{{ name }}</span>
</template>
```

### 0.3 全局注册 `LucideIcon`（`Frontend/src/main.js`）

在 `createApp(App)` 之后、`app.mount('#app')` 之前插入：

```js
import LucideIcon from './components/LucideIcon.vue'
app.component('LucideIcon', LucideIcon)
```

### 0.4 添加全局 Lucide 图标样式（`Frontend/src/style.css`）

```css
/* Lucide 图标与文字对齐 */
svg.lucide, .lucide {
  vertical-align: middle;
  flex-shrink: 0;
}
```

**Phase 0 验证**：`npm run dev` 启动无报错。

---

## Emoji → Lucide 映射表（全局唯一来源）

| Emoji | Lucide `name` | 语义 |
|-------|-------------|------|
| `←` | `ArrowLeft` | 返回 |
| `🏠` | `Home` | 首页 |
| `🔍` | `Search` | 搜索 |
| `💰` | `Coins` | 资金/定投 |
| `📊` | `BarChart3` | 数据/图表 |
| `☀️` | `Sun` | 浅色模式 |
| `🌙` | `Moon` | 深色模式 |
| `🖥️` | `Monitor` | 跟随系统 |
| `📈` | `TrendingUp` | 上涨 |
| `📉` | `TrendingDown` | 下跌 |
| `🔄` | `RefreshCw` | 刷新 |
| `⚠️`/`⚠` | `TriangleAlert` | 警告/风险 |
| `✅`/`✓` | `Check` | 通过/成功 |
| `❌`/`✕` | `X` | 失败/关闭 |
| `⭐`/`★` | `Star` | 收藏/星级 |
| `☆` | `Star` | 未收藏（空心） |
| `🤖` | `Bot` | AI 分析 |
| `📰` | `Newspaper` | 新闻 |
| `🔥` | `Flame` | 热门 |
| `🚀` | `Rocket` | 强势/买入 |
| `🔮`/`🔭` | `Telescope` | 展望 |
| `💡` | `Lightbulb` | 总结/提示 |
| `📅` | `Calendar` | 日期 |
| `🌐`/`🌍` | `Globe` | 全球/国际 |
| `🏭` | `Factory` | 板块/行业 |
| `🥇` | `Award` | 贵金属/第一 |
| `👨‍💼` | `UserCircle` | 基金经理 |
| `👥` | `Users` | 持有人 |
| `💼` | `Briefcase` | 持仓 |
| `🎯` | `Target` | 目标/初始 |
| `📁` | `Folder` | 文件夹 |
| `📂` | `FolderOpen` | 打开文件夹 |
| `📋` | `ClipboardList` | 列表/对比 |
| `🗑️` | `Trash2` | 删除 |
| `✏️` | `Pencil` | 编辑 |
| `⚙️` | `Settings` | 高级设置 |
| `▼` | `ChevronDown` | 展开/下拉 |
| `▲` | `ChevronUp` | 收起/上拉 |
| `▶` | `ChevronRight` | 向右展开 |
| `↑` | `ArrowUp` | 上涨箭头 |
| `↓` | `ArrowDown` | 下跌箭头 |
| `→` | `ArrowRight` | 右箭头 |
| `📦` | `Package` | 数据包/缓存 |
| `📥` | `Download` | 入站/更新 |
| `⏳` | `Hourglass` | 等待中 |
| `⏹` | `Square` | 停止 |
| `📌` | `Pin` | 图钉 |
| `📑` | `FileText` | 报告 |
| `📄` | `FileText` | 文档 |
| `👜` | `Briefcase` | 持仓（alt） |
| `📭` | `MailOpen` | 空/无数据 |
| `🕐` | `Clock` | 更新时间 |
| `🏆` | `Trophy` | 排名 |
| `👤` | `User` | 用户/经理 |
| `👆` | `ArrowBigUp` | 提示/指上 |
| `👈` | `ArrowBigLeft` | 提示/指左 |
| `🔁` | `Repeat` | 循环/变动 |
| `💹` | `JapaneseYen` | 收益曲线 |
| `+📁` | `FolderPlus` | 添加分组 |

> 注：`☆`（空心星）和 `★`（实心星）均映射到 `Star`，通过 `fill` 属性区分。

---

## Phase 1: 简单文件（标题 emoji + 1~2 个图标）

这些文件改动最小，适合快速推进。每个文件约 2~5 处修改。

### 1.1 `FundChart.vue` — 无需修改
该文件无 emoji 图标。

### 1.2 `FundEvaluation.vue:4`
- `📊 综合评测` → `<LucideIcon name="BarChart3" :size="20" /> 综合评测`

### 1.3 `FundPortfolio.vue:4`
- `📈 持仓明细` → `<LucideIcon name="TrendingUp" :size="20" /> 持仓明细`

### 1.4 `FundRankingTrend.vue:4`
- `🏆 同类排名走势` → `<LucideIcon name="Trophy" :size="20" /> 同类排名走势`

### 1.5 `FundScaleChange.vue:4`
- `📈 规模变化` → `<LucideIcon name="TrendingUp" :size="20" /> 规模变化`

### 1.6 `FundSameType.vue:4`
- `📈 同类型涨幅排行` → `<LucideIcon name="TrendingUp" :size="20" /> 同类型涨幅排行`

### 1.7 `FundHolderStructure.vue:4`
- `👥 持有人结构` → `<LucideIcon name="Users" :size="20" /> 持有人结构`

### 1.8 `FundSubscription.vue:4`
- `💰 申购赎回` → `<LucideIcon name="Coins" :size="20" /> 申购赎回`

### 1.9 `FundAbilityEval.vue:4`
- `📊 历史表现评测` → `<LucideIcon name="BarChart3" :size="20" /> 历史表现评测`

### 1.10 `FundAssetAllocation.vue:4,9`
- L4: `📊 资产配置` → `<LucideIcon name="BarChart3" :size="20" /> 资产配置`
- L9: `⚠` → `<LucideIcon name="TriangleAlert" :size="16" />`

### 1.11 `ResearchDashboard.vue:239`
- `✅` → `<LucideIcon name="Check" :size="16" />`

### 1.12 `SectorRank.vue:5,12,20,26-29,114,117,224`
- L5: `🏭 板块排行` → `<LucideIcon name="Factory" :size="20" /> 板块排行`
- L12: `🔄` → `<LucideIcon name="RefreshCw" :size="16" />`
- L20: `⛶` → 保留或用 `MapPin`
- L26~29: `↑`/`↓` 箭头 → `ArrowUp`/`ArrowDown`
- L114: `📦 缓存` → `<LucideIcon name="Package" :size="14" />`
- L117: `{{ isStale ? '📅' : '' }}` → `<LucideIcon v-if="isStale" name="Calendar" :size="14" />`
- L224: `→` → `ArrowRight`

### 1.13 `StockPopup.vue:11`
- `⚠️` → `<LucideIcon name="TriangleAlert" :size="16" />`

### 1.14 `MarketDashboard.vue:5,75-78`
- L5: `📈 市场实时数据` → `<LucideIcon name="TrendingUp" :size="22" /> 市场实时数据`
- L75-78: tabs 对象中的 `icon` 属性改为 lucide name，模板中改为 `<LucideIcon :name="tab.icon" :size="16" />`

### 1.15 `MyPositions.vue:4,51,129,133`
- L4: `💼 我的持仓` → `<LucideIcon name="Briefcase" :size="22" />`
- L51: `🔁 持仓变动` → `<LucideIcon name="Repeat" :size="18" />`
- L129: `📊` → `<LucideIcon name="BarChart3" :size="18" />`
- L133: `📈` → `<LucideIcon name="TrendingUp" :size="18" />`

### 1.16 `FundSearch.vue:20`
- `🔄` → `<LucideIcon name="RefreshCw" :size="16" />`

### 1.17 `FundBasicInfo.vue:16,54`
- L16: `{{ isInWatchlist ? '★' : '☆' }}` → `<LucideIcon name="Star" :size="18" :fill="isInWatchlist ? 'currentColor' : 'none'" />`
- L54: `🤖 AI分析` → `<LucideIcon name="Bot" :size="16" /> AI分析`

### 1.18 `FundManagerInfo.vue:4,19,24,27`
- L4: `👨‍💼 基金经理` → `<LucideIcon name="UserCircle" :size="20" /> 基金经理`
- L19: `★` 星级 → `<LucideIcon name="Star" :size="14" />`
- L24: `📅` → `<LucideIcon name="Calendar" :size="14" />`
- L27: `💰` → `<LucideIcon name="Coins" :size="14" />`

### 1.19 `FundListItems.vue:40,65,73,77`
- L40: `{{ isInCompare(fund.fund_code) ? '✓' : '+' }}` → 动态 LucideIcon（`Check`/`Plus`）
- L65/73: `+`/`✕` 行内按钮 → `Plus`/`X`
- L77: `✕ 移除` → `<LucideIcon name="X" :size="14" />`

**Phase 1 验证**：任意页面浏览，确认图标渲染正常。

---

## Phase 2: 中等复杂度文件（模板+少量 JS 混合）

### 2.1 `FlashNews.vue:7,13,29,36,85`
- L7: `📰 7×24快讯` → `<LucideIcon name="Newspaper" :size="18" />`
- L13: `🔄` 刷新旋转 → `<LucideIcon name="RefreshCw" :size="16" />`
- L29: `⚠️` → `<LucideIcon name="TriangleAlert" :size="20" />`
- L36: `📭` → `<LucideIcon name="MailOpen" :size="28" />`
- L85: `✕` → `<LucideIcon name="X" :size="18" />`

### 2.2 `MarketOverview.vue:6,28,30,36,48,62,73,90,106,113`
- L6: `📉 大盘指数` → `<LucideIcon name="TrendingDown" :size="20" />`
- L28: `🌍 全球市场` → `<LucideIcon name="Globe" :size="20" />`
- L30: `🔄` → `<LucideIcon name="RefreshCw" :size="16" />`
- L36: `🇨🇳` → 保留 emoji（无合适 Lucide 图标）
- L48: `🌐` → `<LucideIcon name="Globe" :size="16" />`
- L62: `📊` → `<LucideIcon name="BarChart3" :size="20" />`
- L73: `🥇` → `<LucideIcon name="Award" :size="20" />`
- L90: `📈` → `<LucideIcon name="TrendingUp" :size="14" />`
- L106: `📈` → `<LucideIcon name="TrendingUp" :size="20" />`
- L113: `✕` → `<LucideIcon name="X" :size="18" />`

### 2.3 `FundBacktest.vue:4,209,256,279,280`
- L4: `📊 定投回测` → `<LucideIcon name="BarChart3" :size="20" />`
- L209: `📈` → `<LucideIcon name="TrendingUp" :size="18" />`
- L256: `💹` → `<LucideIcon name="JapaneseYen" :size="18" />`
- L279: `📋` → `<LucideIcon name="ClipboardList" :size="18" />`
- L280: `{{ showDetail ? '▼' : '▶' }}` → `<LucideIcon :name="showDetail ? 'ChevronDown' : 'ChevronRight'" :size="16" />`

### 2.4 `FundDetail.vue:171,178`
- L171: `⚠️` → `<LucideIcon name="TriangleAlert" :size="32" />`
- L178: `📊` → `<LucideIcon name="BarChart3" :size="32" />`

**Phase 2 验证**：市场大盘页、基金回测页、快讯正常。

---

## Phase 3: 复杂文件（大量模板 + JS 对象/计算属性）

### 3.1 `App.vue`（9 处）

**模板替换**：
| 行 | 原内容 | 替换为 |
|----|--------|--------|
| 22 | `← 返回` | `<LucideIcon name="ArrowLeft" :size="18" /> 返回` |
| 29 | `{{ themeIcon }}` | `<LucideIcon :name="themeIcon" :size="20" />` |
| 37 | `🏠 市场大盘` | `<LucideIcon name="Home" :size="16" /> 市场大盘` |
| 44 | `🔍 基金筛选` | `<LucideIcon name="Search" :size="16" /> 基金筛选` |
| 51 | `💰 定投回测` | `<LucideIcon name="Coins" :size="16" /> 定投回测` |
| 58 | `📊 估值与持仓` | `<LucideIcon name="BarChart3" :size="16" /> 估值与持仓` |
| 159 | `🔍` | `<LucideIcon name="Search" :size="48" />` |

**JS 计算属性修改**：
```js
// 原 → 新
'🌙' → 'Moon'
'🖥️' → 'Monitor'
'☀️' → 'Sun'
```

### 3.2 `DailyMarketSummary.vue`（11 处模板 + 1 计算属性）

模板同标准映射表。

**JS 计算属性修改**：
```js
// 原
const sentimentIcon = computed(() => {
  const s = props.data?.market_sentiment
  if (!s) return '📈'
  if (s.includes('乐观') || s.includes('上涨') || s.includes('bull')) return '🚀'
  if (s.includes('悲观') || s.includes('下跌') || s.includes('bear')) return '📉'
  return '📊'
})
// 新
const sentimentIcon = computed(() => {
  const s = props.data?.market_sentiment
  if (!s) return 'TrendingUp'
  if (s.includes('乐观') || s.includes('上涨') || s.includes('bull')) return 'Rocket'
  if (s.includes('悲观') || s.includes('下跌') || s.includes('bear')) return 'TrendingDown'
  return 'BarChart3'
})
```

### 3.3 `FundAIAnalysis.vue`（12 处）

**JS 对象修改**：
```js
// 原 dashboardItems
{ icon: '📈' } → { icon: 'TrendingUp' }
{ icon: '👨‍💼' } → { icon: 'UserCircle' }
{ icon: '📊' } → { icon: 'BarChart3' }
{ icon: '🔮' } → { icon: 'Telescope' }
```

模板 `{{ item.icon }}` → `<LucideIcon :name="item.icon" :size="18" />`

`adviceIcon` 计算属性中：
- `📊` → `BarChart3`, `🚀` → `Rocket`, `📉` → `TrendingDown`, `⏳` → `Hourglass`

### 3.4 `FundWatchlist.vue`（14 处）

| 行 | 原 | 新 |
|----|----|----|
| 10 | `📈` | `TrendingUp` |
| 21 | `👆` | `ArrowBigUp` |
| 31 | `⭐` | `Star` |
| 37 | `+📁` | `FolderPlus` |
| 64 | `🔄` | `RefreshCw` |
| 71 | `📊` | `BarChart3` |
| 84 | `📋` | `ClipboardList` |
| 86 | `⭐` | `Star` |
| 94/130 | `▼`/`▶` | `ChevronDown`/`ChevronRight` |
| 131 | `📁` | `Folder` |
| 134 | `✏️` | `Pencil` |
| 135 | `🗑️` | `Trash2` |

### 3.5 `FundScreening.vue`（25 处 — 最复杂）

| 行 | 原 emoji | Lucide name |
|----|---------|-------------|
| 8 | `📦` | `Package` |
| 11 | `✅` | `Check` |
| 14 | `🕐` | `Clock` |
| 24 | `⏳`/`📥` | `Hourglass`/`Download`（动态） |
| 42 | `🔄` | `RefreshCw` |
| 49 | `📋` | `ClipboardList` |
| 118 | `⏹` | `Square` |
| 128 | `🔎` | `Search` |
| 153 | `📁` | `Folder` |
| 158 | `▼` | `ChevronDown` |
| 172 | `✓`/`−` | `Check`/`Minus`（动态） |
| 196 | `🔍` | `Search` |
| 208 | `✕` | `X` |
| 298 | `⚙️` | `Settings` |
| 299 | `▲`/`▼` | `ChevronUp`/`ChevronDown` |
| 379 | `✓` | `Check` |
| 383 | `★` | `Star` |
| 384 | `▦` | `LayoutGrid` |
| 413 | `📭` | `MailOpen` |
| 420 | `🎯` | `Target` |

JS 对象 `fundTypeCategories` 和 `quickTypeCategories` 中的 `icon` 属性改为 lucide name，模板中改为 `<LucideIcon :name="cat.icon" :size="16" />`。

### 3.6 `FundRealtime.vue`（20 处）

| 行 | 原 | Lucide name |
|----|----|----|
| 26 | `📊` | `BarChart3` |
| 61 | `⏳` | `Hourglass` |
| 62 | `▲`/`▼` | `ChevronUp`/`ChevronDown` |
| 78 | `👜` | `Briefcase` |
| 88 | `📁` | `Folder` |
| 90 | `+📁` | `FolderPlus` |
| 91 | `⚖️` | `Scale` |
| 95 | `📉` | `TrendingDown` |
| 105 | `✏️` | `Pencil` |
| 106 | `🗑️` | `Trash2` |
| 135 | `📂` | `FolderOpen` |
| 145 | `📈` | `TrendingUp` |
| 152 | `📊` | `BarChart3` |
| 174 | `👜` | `Briefcase` |
| 175 | `📄` | `FileText` |
| 266 | `📌` | `Pin` |
| 363 | `⚠️` | `TriangleAlert` |
| 364 | `✓` | `Check` |
| 370 | `📦` | `Package` |

### 3.7 `FundComparison.vue`（10 处）

| 行 | 原 | Lucide name |
|----|----|----|
| 5 | `📈` | `TrendingUp` |
| 22 | `👆` | `ArrowBigUp` |
| 51 | `📊` | `BarChart3` |
| 75 | `📋` | `ClipboardList` |
| 92 | `📈` | `TrendingUp` |
| 127 | `💼` | `Briefcase` |
| 144 | `⚠️` | `TriangleAlert` |
| 179 | `⭐` | `Star` |
| 222 | `👤` | `User` |
| 259 | `👈` | `ArrowBigLeft` |

**Phase 3 验证**：逐个组件验证 — App 导航 → 筛选页 → 实时页 → 对比页 → AI 分析 → 自选列表。

---

## Phase 4: CSS 清理

### 4.1 移除 emoji 相关 CSS

在以下文件中找到 `.icon`、`.theme-icon`、`.error-icon`、`.empty-icon`、`.welcome-icon`、`.hint-icon`、`.header-icon`、`.toggle-icon`、`.section-icon`、`.summary-icon`、`.index-icon`、`.btn-icon`、`.btn-icon-sm`、`.check-icon`、`.input-icon`、`.confirm-option-icon` 等类：

- 保留 `display`、`margin`、`padding`、`background` 等布局样式
- **移除 `font-size`**（Lucide 用 SVG `size` prop 控制尺寸）
- 改为添加 `display: inline-flex; align-items: center;`（确保图标居中）

### 4.2 需要清理的文件清单

`App.vue`, `StockPopup.vue`, `FundListItems.vue`, `FundManagerInfo.vue`, `FlashNews.vue`, `FundWatchlist.vue`, `DailyMarketSummary.vue`, `ResearchDashboard.vue`, `FundScreening.vue`, `FundDetail.vue`, `FundAIAnalysis.vue`, `FundRealtime.vue`, `FundBacktest.vue`, `SectorRank.vue`, `MyPositions.vue`, `FundBasicInfo.vue`, `FundComparison.vue`, `MarketDashboard.vue`, `FundAssetAllocation.vue`, `FundSearch.vue`

### 4.3 验证

每清除一个文件的 emoji CSS 后检查 UI 是否无 layout shift。

---

## 模板替换速查（常用模式）

### 模式 A：标题中的内联 emoji
```html
<!-- 原 -->
<h3>📊 资产配置</h3>
<!-- 新 -->
<h3><LucideIcon name="BarChart3" :size="20" /> 资产配置</h3>
```

### 模式 B：按钮中的 emoji
```html
<!-- 原 -->
<button>🔄 刷新</button>
<!-- 新 -->
<button><LucideIcon name="RefreshCw" :size="16" /> 刷新</button>
```

### 模式 C：条件动态 emoji
```html
<!-- 原 -->
<span>{{ showDetail ? '▼' : '▶' }}</span>
<!-- 新 -->
<LucideIcon :name="showDetail ? 'ChevronDown' : 'ChevronRight'" :size="16" />
```

### 模式 D：JS 对象中的 icon 属性
```js
// 原
const tabs = [{ icon: '🌐', label: '概览' }]
// 模板: {{ tab.icon }} {{ tab.label }}
```
```js
// 新
const tabs = [{ icon: 'Globe', label: '概览' }]
// 模板: <LucideIcon :name="tab.icon" :size="16" /> {{ tab.label }}
```

### 模式 E：计算属性中的 emoji
```js
// 原
const sentimentIcon = computed(() => {
  if (bullish) return '🚀'
  return '📊'
})
```
```js
// 新
const sentimentIcon = computed(() => {
  if (bullish) return 'Rocket'
  return 'BarChart3'
})
```

---

## 回滚方案

如中途需要回滚某个文件：
1. `git checkout -- <file>` 恢复原文件
2. 若需全部回滚：`git checkout -- Frontend/src/ Frontend/package.json Frontend/package-lock.json`
3. 移除 `@lucide/vue`：`cd Frontend && npm uninstall @lucide/vue`

---

## 状态追踪

| Phase | 文件数 | 状态 |
|-------|--------|------|
| Phase 0 | 4 | ✅ Completed |
| Phase 1 | 19 | ✅ Completed |
| Phase 2 | 5 | ✅ Completed |
| Phase 3 | 7 | ✅ Completed |
| Phase 4 | ~20 | ✅ Completed |
