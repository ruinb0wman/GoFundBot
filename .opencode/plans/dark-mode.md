# Dark Mode 实施计划

## 现状

- **无 UI 库**：纯 Vue 3 + 手写 CSS，仅 VXETable（表格）和 ECharts（图表）
- `App.vue:395-408` 有 10 个 CSS 变量，但**几乎所有 29 个组件都使用硬编码颜色**
- 无 dark mode 切换逻辑，无 `[data-theme]` 属性，无 `prefers-color-scheme` 媒体查询
- VXETable 使用默认主题，ECharts 15 处实例均无注册主题

## 设计令牌（Design Token）体系

所有颜色集中定义为 CSS 变量，分为 **表面色 / 文字色 / 边框色 / 语义色 / 图表色** 五类。

### 表面色（Surfaces）

| 变量名 | 用途 | Light | Dark |
|--------|------|-------|------|
| `--bg-page` | 页面底色 | `#f5f7fa` | `#0f1117` |
| `--bg-primary` | 主背景 | `#f8fafc` | `#12141c` |
| `--bg-card` | 卡片/输入框 | `#ffffff` | `#1a1d2b` |
| `--bg-elevated` | 弹层/下拉/模态 | `#ffffff` | `#232738` |
| `--bg-hover` | hover 状态 | `#f0f2f5` | `#272c3d` |
| `--bg-subtle` | 极浅底色（表头/斑马） | `#f3f4f6` | `#161821` |
| `--bg-overlay` | 遮罩层 | `rgba(0,0,0,0.45)` | `rgba(0,0,0,0.65)` |
| `--bg-gradient` | 渐变（header 等） | `linear-gradient(135deg, #1677ff 0%, #0958d9 100%)` | 同 left（保持品牌色） |

### 文字色（Text）

| 变量名 | 用途 | Light | Dark |
|--------|------|-------|------|
| `--text-primary` | 主要文字 | `#1f2937` | `#e2e8f0` |
| `--text-secondary` | 次要文字/标签 | `#6b7280` | `#94a3b8` |
| `--text-tertiary` | 辅助/提示文字 | `#9ca3af` | `#64748b` |
| `--text-disabled` | 禁用/占位符 | `#d1d5db` | `#475569` |
| `--text-inverse` | 深色底上的文字 | `#ffffff` | `#ffffff` |

### 边框色（Borders）

| 变量名 | 用途 | Light | Dark |
|--------|------|-------|------|
| `--border-default` | 默认边框 | `#e5e7eb` | `#2a3040` |
| `--border-subtle` | 弱边框/分割线 | `#f0f0f0` | `#232738` |
| `--border-strong` | 强边框/聚焦 | `#1677ff` | `#3b82f6` |

### 语义色（Semantic）

| 变量名 | 用途 | Light | Dark |
|--------|------|-------|------|
| `--color-primary` | 主色 | `#1677ff` | `#3b82f6` |
| `--color-primary-hover` | 主色悬停 | `#0958d9` | `#60a5fa` |
| `--color-primary-bg` | 主色浅底 | `#eef4ff` | `#1e2d4a` |
| `--color-primary-border` | 主色边框 | `#91bffa` | `#2a4a8a` |
| `--color-success` | 成功/下跌 | `#52c41a` | `#4ade80` |
| `--color-success-bg` | 成功浅底 | `#f6ffed` | `#1a2e1a` |
| `--color-success-border` | 成功边框 | `#b7eb8f` | `#2a5a2a` |
| `--color-danger` | 危险/上涨 | `#ff4d4f` | `#f87171` |
| `--color-danger-bg` | 危险浅底 | `#fff1f0` | `#2e1a1a` |
| `--color-danger-border` | 危险边框 | `#ffa39e` | `#5a2a2a` |
| `--color-warning` | 警告 | `#faad14` | `#fbbf24` |
| `--color-warning-bg` | 警告浅底 | `#fff7e6` | `#2e2410` |
| `--color-warning-border` | 警告边框 | `#ffd591` | `#5a4a10` |
| `--color-info` | 信息 | `#13c2c2` | `#22d3ee` |
| `--color-info-bg` | 信息浅底 | `#e6fffb` | `#102a2e` |

> 注：A 股市场红涨绿跌，`--color-danger` 表示上涨（红色），`--color-success` 表示下跌（绿色）。组件中的 `.up` / `.down` 类名维持此语义。

### 图表色（Chart Palette）

| 变量名 | Light | Dark |
|--------|-------|------|
| `--chart-1` | `#1677ff` | `#3b82f6` |
| `--chart-2` | `#52c41a` | `#4ade80` |
| `--chart-3` | `#faad14` | `#fbbf24` |
| `--chart-4` | `#ff4d4f` | `#f87171` |
| `--chart-5` | `#73c0de` | `#38bdf8` |
| `--chart-6` | `#3ba272` | `#34d399` |
| `--chart-7` | `#fc8452` | `#fb923c` |
| `--chart-8` | `#9a60b4` | `#c084fc` |
| `--chart-9` | `#ea7ccc` | `#f0abfc` |
| `--chart-10` | `#bfbfbf` | `#787878` |
| `--chart-bg` | `#ffffff` | `#1a1d2b` |
| `--chart-grid` | `#e5e7eb` | `#2a3040` |
| `--chart-axis-label` | `#6b7280` | `#94a3b8` |

### 阴影（Shadows）

| 变量名 | Light | Dark |
|--------|-------|------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.3)` |
| `--shadow-md` | `0 4px 6px -1px rgba(0,0,0,0.1)` | `0 4px 6px -1px rgba(0,0,0,0.4)` |
| `--shadow-lg` | `0 10px 15px -3px rgba(0,0,0,0.1)` | `0 10px 15px -3px rgba(0,0,0,0.5)` |

---

## 实施阶段

### 阶段 0：基础设施（Infrastructure）

**目标**：切换开关可用 + 全局框架色生效，页面可切深色但不美观。

#### 0.1 创建主题管理 composable
- **文件**：`Frontend/src/composables/useTheme.js`（新建）
- **内容**：
  - 从 `localStorage` 读取用户偏好（`"light"` / `"dark"` / `"auto"`）
  - 监听 `prefers-color-scheme` 媒体查询
  - 在 `<html>` 上设置/移除 `data-theme="dark"` 属性
  - 导出 `theme` (ref) + `toggleTheme()` 方法
  - 如果是 `"auto"`，回读系统偏好作为初始值

#### 0.2 定义全部 CSS 变量（Light + Dark）
- **文件**：`Frontend/src/App.vue` `<style>` 块
- **改动**：
  - 扩展 `:root` 块，加入全部 ~45 个设计令牌
  - 新增 `:root[data-theme="dark"]` 块，覆盖为 dark 值
  - 保留现有 10 个变量名（`--primary-color`, `--bg-card` 等）不变，升级为 alias 或直接替换为新令牌值

#### 0.3 添加切换按钮
- **文件**：`Frontend/src/App.vue` `<template>` + `<script>`
- **改动**：
  - 在 `header-right` 区域添加 sun/moon 图标按钮（CSS-only，无额外依赖）
  - 引入 useTheme composable
  - 绑定点击事件，三种状态循环: `light → dark → auto → light`

#### 0.4 更新初始加载/错误样式
- **文件**：`Frontend/index.html` `<style>` 块
- **改动**：
  - `body` 中 `background-color` / `color` 用 CSS 变量 + 硬编码 fallback
  - `app-loading` 和 `app-error` 中的硬编码颜色用变量替换
  - 新增 `@media (prefers-color-scheme: dark)` 媒体查询做 Vue 未加载时的兜底

#### 0.5 ECharts 主题适配器
- **文件**：`Frontend/src/composables/useEChartsTheme.js`（新建）
- **内容**：
  - `registerLightTheme()` / `registerDarkTheme()` 注册两个 ECharts 主题
  - 主题从 CSS 变量读取值（`getComputedStyle`）
  - `getThemeName()`: 返回当前 `"gofund-light"` 或 `"gofund-dark"`
  - 仅在首次调用时注册一次（用 flag 防重复）

#### 0.6 VXETable 主题配置
- **文件**：`Frontend/src/main.js`
- **改动**：调用 `VXETable.setup()` 传入表格主题配置，色值引用 CSS 变量
- **文件**：`Frontend/src/style.css`
- **改动**：添加 VXETable dark override（`[data-theme="dark"] .vxe-*` 系列选择器覆盖深色变量）

---

### 阶段 1：框架与布局（Frame & Layout）

**目标**：主结构（header/footer/main/sidebar）在 dark 下正确显示。

#### 1.1 App.vue `<style>` 块
- 替换 ~45 处硬编码色为 CSS 变量引用
- 涉及: header, footer, mode-switch, back-btn, welcome-container
- `.app-header` 渐变背景保持品牌色不变
- Header 内的 search bar overlay / btn 用 CSS 变量

#### 1.2 style.css
- `body` 背景和文字色引用变量
- 滚动条深色适配
- 工具类（`.text-*`, `.mt-*` 等）无颜色，保持不变

#### 1.3 index.html
- 已在 0.4 处理

---

### 阶段 2：大盘页面组件（Dashboard Components）

**目标**：市场大盘页完整 dark 适配。

| # | 组件 | 硬编码色预估 | 特殊处理 |
|---|------|------------|---------|
| 2.1 | `MarketOverview.vue` | ~50 | ECharts 图表 + vue-echarts `VChart` 组件 |
| 2.2 | `DailyMarketSummary.vue` | ~45 | 纯 CSS |
| 2.3 | `FlashNews.vue` | ~40 | 纯 CSS |
| 2.4 | `SectorRank.vue` | ~50 | 纯 CSS + modal |
| 2.5 | `MarketDashboard.vue` | ~12 | 少量硬编码，部分已用变量 |
| 2.6 | `FundSearch.vue` | ~15 | 顶栏搜索框，全局使用 |
| 2.7 | `FundWatchlist.vue` | ~15 | 左侧自选列表，全局使用 |

**处理要点**：
- 2.1: `MarketOverview.vue` 使用 `vue-echarts` 的 `<VChart>` 组件，通过 prop `theme` 切换主题名
- 其余组件：纯 CSS 变量替换，无 JS 逻辑改动

---

### 阶段 3：基金详情组件（Fund Detail Components）

**目标**：基金详情页及所有子组件 dark 适配。

| # | 组件 | 硬编码色 | 特殊处理 |
|---|------|---------|---------|
| 3.1 | `FundDetail.vue` | ~25 | 容器 + Tab 切换 |
| 3.2 | `FundBasicInfo.vue` | ~20 | 渐变卡片头 |
| 3.3 | `FundAIAnalysis.vue` | ~55 | 多状态色 |
| 3.4 | `FundChart.vue` | ~35 | ECharts 折线图 |
| 3.5 | `FundAbilityEval.vue` | ~10 | ECharts 雷达图 |
| 3.6 | `FundRankingTrend.vue` | ~12 | ECharts 折线图 |
| 3.7 | `FundAssetAllocation.vue` | ~15 | ECharts 饼图 |
| 3.8 | `FundEvaluation.vue` | ~30 | ECharts 雷达图 + 柱状图 |
| 3.9 | `FundHolderStructure.vue` | ~12 | ECharts 柱状图 |
| 3.10 | `FundScaleChange.vue` | ~8 | ECharts 面积图 |
| 3.11 | `FundSubscription.vue` | ~10 | ECharts 图 |
| 3.12 | `FundManagerInfo.vue` | ~20 | ECharts 多图 |
| 3.13 | `FundSameType.vue` | ~18 | 纯 CSS |
| 3.14 | `FundListItems.vue` | ~15 | 纯 CSS |
| 3.15 | `FundPortfolio.vue` | ~15 | 纯 CSS |

**处理要点**：
- 有 ECharts 的组件（3.4~3.12）：
  - 将 `echarts.init(el)` 改为 `echarts.init(el, getThemeName())`
  - 将 `setOption` 中的硬编码色替换为 `getComputedStyle(document.documentElement).getPropertyValue('--chart-*')`
  - 引入 `useEChartsTheme` composable 的 watch，主题切换时 dispose + re-init
- 纯 CSS 组件：直接替换颜色值为 `var(--token)` 引用

---

### 阶段 4：功能页面组件（Feature Page Components）

| # | 组件 | 硬编码色 | 特殊处理 |
|---|------|---------|---------|
| 4.1 | `FundRealtime.vue` | ~180 | 最重：估值卡片矩阵 |
| 4.2 | `FundScreening.vue` | ~120 | 多维筛选面板 |
| 4.3 | `ResearchDashboard.vue` | ~50 | 纯 CSS（无图表） |
| 4.4 | `FundBacktest.vue` | ~60 | ECharts 复杂图表 + `LinearGradient` |
| 4.5 | `FundComparison.vue` | ~55 | ECharts 多基金对比图 |
| 4.6 | `MyPositions.vue` | ~15 | ECharts 图表 |
| 4.7 | `StockPopup.vue` | ~65 | ECharts K 线图 + `LinearGradient` |

**处理要点**：
- 4.1/4.2 纯 CSS 量大但无图表，逐个类名替换
- ECharts 组件处理同阶段 3
- `LinearGradient`（黑色渐变填充）在 dark 下改为用对比度更低的颜色或透明渐变

---

### 阶段 5：收尾（Polish & Verify）

- 启动 `npm run dev`，在全深色模式下逐页走查
- ECharts `LinearGradient` 的 4 处特殊适配验证：
  - `FundBacktest.vue`: 定投回测区域填充
  - `FundChart.vue`: 净值走势面积图
  - `FundScaleChange.vue`: 规模变动面积图
  - `StockPopup.vue`: K 线图成交量柱
- VXETable 表格表头/斑马纹/排序图标深色微调
- 检查所有 `rgba(255,255,255,*)` 的 overlay/分割线在 dark 下是否合理
- 检查所有 ECharts `tooltip` 背景色是否需要适配

---

## 颜色替换速查表

在修改组件时，按此规则做 `grep → replace`：

| 旧颜色（正则匹配目标） | 新变量引用 |
|---|---|
| `#fff\b`, `white`, `#ffffff` | `var(--bg-card)` 或 `var(--bg-elevated)` |
| `#f5f7fa`, `#f8fafc` | `var(--bg-page)` 或 `var(--bg-primary)` |
| `#f0f0f0`, `#f5f5f5`, `#fafafa`, `#f3f4f6`, `#f8f9fa` | `var(--bg-subtle)` |
| `#f0f2f5` | `var(--bg-hover)` |
| `#333\b`, `#1f2937`, `#1a1a1a`, `#111827`, `#303133` | `var(--text-primary)` |
| `#666\b`, `#6b7280`, `#595959`, `#4b5563`, `#606266`, `#475467` | `var(--text-secondary)` |
| `#999\b`, `#9ca3af`, `#8c8c8c`, `#909399` | `var(--text-tertiary)` |
| `#d1d5db`, `#ccc\b`, `#c0c7d0`, `#dcdfe6` | `var(--text-disabled)` |
| `#eee\b`, `#e5e7eb`, `#ddd\b`, `#e8e8e8`, `#d0d5dd`, `#ebeef5` | `var(--border-default)` |
| `#1677ff` | `var(--color-primary)` |
| `#0958d9` | `var(--color-primary-hover)` |
| `#e6f7ff`, `#eef4ff`, `#f0f5ff`, `#ecf5ff`, `#d9ecff` | `var(--color-primary-bg)` |
| `#52c41a`, `#16a34a`, `#67c23a` | `var(--color-success)` |
| `#f6ffed`, `#f0fdf4`, `#ecfdf5` | `var(--color-success-bg)` |
| `#ff4d4f`, `#dc2626`, `#ef4444`, `#f5222d`, `#cf1322`, `#F56C6C` | `var(--color-danger)` |
| `#fff1f0`, `#fff5f5`, `#fee2e2`, `#fef0f0` | `var(--color-danger-bg)` |
| `#faad14`, `#fa8c16`, `#E6A23C` | `var(--color-warning)` |
| `#fff7e6`, `#fffbeb`, `#fef7e0` | `var(--color-warning-bg)` |
| `#13c2c2`, `#1890ff`, `#409EFF` | `var(--color-info)` |
| `#e6fffb` | `var(--color-info-bg)` |
| `rgba(0,0,0,0.05)` | `var(--shadow-sm)` |
| `rgba(0,0,0,0.1)`, `rgba(0,0,0,0.08)` | `var(--shadow-md)` |
| `rgba(0,0,0,0.12)`, `rgba(0,0,0,0.15)` | `var(--shadow-lg)` |

---

## 文件修改清单

```
Frontend/
├── index.html                               # 0.4
├── src/
│   ├── main.js                              # 0.6
│   ├── style.css                            # 1.2
│   ├── App.vue                              # 0.2 + 0.3 + 1.1
│   ├── composables/
│   │   ├── useTheme.js                      # 0.1（新建）
│   │   └── useEChartsTheme.js               # 0.5（新建）
│   └── components/
│       ├── MarketOverview.vue               # 2.1
│       ├── DailyMarketSummary.vue           # 2.2
│       ├── FlashNews.vue                    # 2.3
│       ├── SectorRank.vue                   # 2.4
│       ├── MarketDashboard.vue              # 2.5
│       ├── FundSearch.vue                   # 2.6
│       ├── FundWatchlist.vue                # 2.7
│       ├── FundDetail.vue                   # 3.1
│       ├── FundBasicInfo.vue                # 3.2
│       ├── FundAIAnalysis.vue               # 3.3
│       ├── FundChart.vue                    # 3.4
│       ├── FundAbilityEval.vue              # 3.5
│       ├── FundRankingTrend.vue             # 3.6
│       ├── FundAssetAllocation.vue          # 3.7
│       ├── FundEvaluation.vue               # 3.8
│       ├── FundHolderStructure.vue          # 3.9
│       ├── FundScaleChange.vue              # 3.10
│       ├── FundSubscription.vue             # 3.11
│       ├── FundManagerInfo.vue              # 3.12
│       ├── FundSameType.vue                 # 3.13
│       ├── FundListItems.vue                # 3.14
│       ├── FundPortfolio.vue                # 3.15
│       ├── FundRealtime.vue                 # 4.1
│       ├── FundScreening.vue                # 4.2
│       ├── ResearchDashboard.vue            # 4.3
│       ├── FundBacktest.vue                 # 4.4
│       ├── FundComparison.vue               # 4.5
│       ├── MyPositions.vue                  # 4.6
│       └── StockPopup.vue                   # 4.7
```

总计: 3 个新建文件 + 32 个修改文件
