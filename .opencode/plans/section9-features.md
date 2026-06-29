# Section 9: 功能完善 — 执行计划

> 生成时间：2026-06-29
> 上次更新：2026-06-29
> 依赖：Section 1-8 全部完成
> 原则：每阶段有独立检查点，中断后按检查点恢复

## 当前进度

| 项 | 状态 | 执行日期 |
|---|:---:|:--------:|
| 9.7 深色模式 | ✅ 完成 | 2026-06-29 |
| 9.3 CSV 导出 | ✅ 完成 | 2026-06-29 |
| 9.4 价格告警 | ✅ 完成 | 2026-06-29 |
| 9.5 市场异动 | ✅ 完成 | 2026-06-29 |
| 9.2 AI 流式 | ✅ 完成 | 2026-06-29 |
| 9.1 定投方案 | ✅ 完成 | 2026-06-29 |
| 9.6 i18n | ✅ 完成 | 2026-06-29 |

---

## 执行顺序总览

```
Phase 1: 9.7 深色模式   → 9.3 导出 CSV     (前端为主, 快速见效)
Phase 2: 9.4 价格告警   → 9.5 市场异动      (共享后端告警基础设施)
Phase 3: 9.2 AI 流式    → 9.1 定投方案       (后端重, 可并行)
Phase 4: 9.6 i18n                          (全栈贯穿, 工作量最大)
```

---

## Phase 1 — 快速见效 (预估 2-3h)

### 9.7 深色模式自动跟随系统完善

**现状**: `useTheme.ts` 已支持 auto 模式 + `data-theme` 属性；`style.css` 有 CSS 变量体系 + VXETable dark overrides；
ECharts 主题已注册 `gofund-light`/`gofund-dark`。但部分组件 scoped style 仍使用硬编码色值。

**阶段 1a — 审计** ✓checkpoint
- 扫描 38 个 `.vue` 文件中的所有硬编码颜色 (`#rrggbb` / `rgb()` / `linear-gradient` 不含 `var(`)
- 生成审计报告: `docs/dark-mode-audit.md`
- **恢复验证**: `docs/dark-mode-audit.md` 存在

**阶段 1b — 修复** ✓checkpoint
- 将所有硬编码颜色替换为 CSS 变量
- 优先修复: FundDetail / FundScreening / FundBasicInfo / FundWatchlist / FundComparison
- 全局过渡: `transition: background-color 0.3s ease, color 0.3s ease`
- **恢复验证**: `rg "color: #[^v]" Frontend/src/components/` 返回 0 结果 (除SVG fill/stroke外)

**阶段 1c — 验证** ✓checkpoint
- 在 `data-theme="dark"` 下手动检查 5 个核心页面: 市场概览 / 基金详情 / 基金筛选 / 自选管理 / 定投回测
- **恢复验证**: visual checklist passed

### 9.3 基金筛选/对比导出 CSV

**现状**: 仅有 FundRealtime.vue 的 JSON 导出 (`exportData`)。需添加 CSV/XLSX 导出。

**阶段 2a — 导出工具** ✓checkpoint
- 新建 `Frontend/src/utils/exportUtils.ts`
  - `exportToCSV(data, columns, filename)` — 纯前端 CSV 生成 (含 BOM for Excel 中文)
  - `exportToExcel(data, columns, filename)` — 可选: 使用 `xlsx` 库
- **恢复验证**: `Frontend/src/utils/exportUtils.ts` 存在

**阶段 2b — 筛选结果导出** ✓checkpoint
- 在 `FundScreening.vue` 添加「导出 CSV」按钮
- 导出当前筛选结果表 (含基金代码/名称/类型/收益率/回撤等列)
- **恢复验证**: 筛选页可见导出按钮; 下载的 CSV 可用 Excel 打开中文正常

**阶段 2c — 对比结果导出** ✓checkpoint
- 在对比区域添加「导出对比」按钮
- 导出多基金对比数据 (横向: 指标; 纵向: 基金代码)
- **恢复验证**: 对比页可见导出按钮; CSV 格式正确

---

## Phase 2 — 告警基础设施 (预估 3-4h)

### 9.4 价格/收益率告警

**现状**: 无告警模型/端点/UI。

**阶段 3a — 后端模型** ✓checkpoint
- 新建 `Backend/models/alert.py` — `AlertRule` 表 (SQLAlchemy)
  - 字段: `id`, `fund_code`, `type` (price_up/price_down/return_above/return_below), `threshold`, `enabled`, `created_at`
- 在 `database.py` 注册模型; auto-create on startup
- **恢复验证**: `Backend/models/alert.py` 存在; `AlertRule.__table__` 可 create

**阶段 3b — 后端 API** ✓checkpoint
- 新建 `Backend/routes/alert_routes.py` (blueprint: `/api/alerts`)
  - `GET /api/alerts` — 列出当前告警规则
  - `POST /api/alerts` — 创建告警规则 (validate_body)
  - `PUT /api/alerts/<id>` — 更新/启停规则
  - `DELETE /api/alerts/<id>` — 删除规则
  - `GET /api/alerts/check` — 检查所有规则 (供前端轮询)
- `schemas/alert_schemas.py` — Pydantic 校验
- `validate_body` 装饰器
- **恢复验证**: `curl localhost:5000/api/alerts` 返回 `[]`

**阶段 3c — 前端告警面板** ✓checkpoint
- `Frontend/src/stores/alertStore.ts` — Pinia store
- `Frontend/src/components/AlertSettings.vue`
  - 在自选列表中为每只基金添加「设置告警」入口
  - 阈值设置: 涨超 X% / 跌超 X%
- `Frontend/src/components/AlertBadge.vue` — Header 中的铃铛图标 + 未读数
- `useNotification` composable — 浏览器 Notification API 封装
- **恢复验证**: 自选基金页面可见告警设置按钮

### 9.5 市场异动预警

**现状**: 无市场异常检测机制。

**阶段 4a — 后端检测逻辑** ✓checkpoint
- 扩展 `alert_routes.py` 或新建 `services/market_alert.py`
  - 涨跌停检测: 主板 ±10%, 创业板/科创板 ±20%
  - 成交量突增: 当日成交量 > 20日均量 × 2
  - 板块轮动: 上一交易日强势板块今日转弱 (可选)
- `GET /api/alerts/market-anomaly` — 返回今日异动列表
- **恢复验证**: endpoint 返回 JSON (可能空数组)

**阶段 4b — 前端展示** ✓checkpoint
- `MarketOverview.vue` 添加「市场异动」卡片/区域
- 展示: 涨停/跌停股、单日巨量、板块轮动
- 使用 `AlertBadge` 显示未读数
- **恢复验证**: 市场概览页可见异动区域 (交易日有数据或显示「今日无异动」)

---

## Phase 3 — 后端核心功能 (预估 4-5h)

### 9.2 AI 分析流式输出 (SSE)

**现状**: `ai_service.py._call_llm_simple()` 使用 `stream=False`; 前端 `FundAIAnalysis.vue` 全量等待。
`DailyMarketSummary.vue` 使用轮询方式 (已有 polling 经验)。

**阶段 5a — 后端 SSE 流式** ✓checkpoint
- 在 `ai_service.py` 添加 `_call_llm_stream()` 生成器函数
  - 使用 `OpenAI().chat.completions.create(stream=True)`
  - yield SSE chunks
- 新建 `POST /api/fund/<code>/ai-analysis/stream` — SSE 端点
  - 使用 `flask.Response` + `text/event-stream` content-type
  - generator 逐块返回
- 复用现有 prompt 构建逻辑 (`_build_fund_analysis_prompt`)
- **恢复验证**: `curl -N -X POST localhost:5000/api/fund/000001/ai-analysis/stream` 逐行输出 SSE data

**阶段 5b — 前端 SSE 消费** ✓checkpoint
- `FundAIAnalysis.vue` 切换到 EventSource / fetch + ReadableStream
  - 实时显示已接收的 token（打字机效果）
  - 评分/仪表盘等结构化字段在 `[DONE]` 后解析
- 保留旧版全量接口作降级 (fallback on SSE fail)
- **恢复验证**: 基金详情页点击 AI 分析，首字延迟 <2s; 逐字流式渲染

**阶段 5c — 市场摘要流式化** (可选)
- 将 `DailyMarketSummary.vue` 轮询方式切换为 SSE
- **恢复验证**: 市场概览页 AI 摘要流式加载

### 9.1 基金定投方案生成

**现状**: `services/backtest.py._run_backtest()` 实现固定频率回测 (monthly/weekly/lump_sum), 支持止盈止损。
前端 `Backtest.vue` 调用 `POST /api/backtest/fixed-investment`。

**阶段 6a — 策略推荐引擎** ✓checkpoint
- 新建 `Backend/services/backtest_strategies.py`
  - `suggest_optimal_plan(nav_dict, dates)` — 基于历史数据推荐最优策略
    - 均线策略: 净值低于 N 日均线时加仓, 高于时减仓
    - 估值策略: 基于 PE/PB 百分位的定投倍率
    - 波动率自适应: 高波动时降频, 低波动时升频
  - 返回: 推荐策略/频率/金额/预期收益
- 新增 `POST /api/backtest/strategy-suggest` endpoint
- **恢复验证**: endpoint 对有效数据返回策略推荐 JSON

**阶段 6b — 前端优化** ✓checkpoint
- `Backtest.vue` 添加「智能推荐策略」按钮
- 对比视图: 普通定投 vs 策略定投的收益曲线对比
- 策略说明卡片
- **恢复验证**: 定投页可选策略, 对比图可见

---

## Phase 4 — 全栈国际化 (预估 4-6h)

### 9.6 i18n 国际化

**现状**: 全部硬编码中文。无 i18n 框架。38 个 Vue 组件 + 后端 API 错误消息均为中文。

**阶段 7a — 框架搭建** ✓checkpoint
- 安装 `vue-i18n` v9
- 新建 `Frontend/src/locales/index.ts` — i18n 实例
- 新建 `Frontend/src/locales/zh-CN.json` — 中文基础骨架
- 新建 `Frontend/src/locales/en.json` — 英文 (初始为中文待翻译)
- `main.ts` 注册 i18n 插件
- **恢复验证**: `npm run dev` 不报错; `$t()` 可用

**阶段 7b — 文本提取 (分批)** ✓checkpoint
- 优先组件 (5个): `App.vue`, `Header.vue`, `MarketOverview.vue`, `FundDetail.vue`, `FundSearch.vue`
- 次级组件 (10个): 自选/筛选/对比/回测/实时估值/AI分析
- 其余组件 (23个): 批量处理
- 每批完成即 `zh-CN.json` key 数递增
- **恢复验证**: `wc -l Frontend/src/locales/zh-CN.json` 显示已提取行数

**阶段 7c — 语言切换 UI** ✓checkpoint
- 在 `Header.vue` 添加语言切换器 (zh/en 下拉)
- 语言偏好持久化 localStorage: `gofund-locale`
- **恢复验证**: Header 可见语言切换器

**阶段 7d — 后端错误消息** ✓checkpoint (可选)
- `Backend/core/errors.py` 错误消息多语言化
- 根据 `Accept-Language` 请求头返回对应语言
- **恢复验证**: `curl -H "Accept-Language: en"` 返回英文错误消息

---

## 恢复指南

执行中断后, 按以下步骤恢复:

1. **读 plan 文件**: `.opencode/plans/section9-features.md`
2. **找最近检查点**: 从状态文件或最近 checkpoint 标记处继续
3. **验证检查点**: 运行检查点验证命令确认前置阶段仍有效
4. **继续执行**: 从下一个阶段开始

## 总预估

| Phase | 项 | 预估 |
|-------|-----|------|
| 1 | 9.7 深色模式 + 9.3 导出 | 2-3h |
| 2 | 9.4 价格告警 + 9.5 市场异动 | 3-4h |
| 3 | 9.2 AI 流式 + 9.1 定投方案 | 4-5h |
| 4 | 9.6 i18n | 4-6h |
| **合计** | | **13-18h** |
