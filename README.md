# GoFundBot

[![CI](https://github.com/Sebastian6848/GoFundBot/actions/workflows/ci.yml/badge.svg)](https://github.com/Sebastian6848/GoFundBot/actions/workflows/ci.yml)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)]() [![Vue.js](https://img.shields.io/badge/Vue.js-3-green.svg)]()

GoFundBot 是一个基于 Node.js (Express) 和 Vue 3 构建的智能基金分析与可视化工具。它不仅提供实时的基金数据查询和可视化图表，还集成了先进的 AI 大模型（LLM），为用户提供深度的基金投资分析、风险评估及市场研判报告。所有持久化数据存储在浏览器端 IndexedDB（Dexie.js）中，服务端无状态。

**架构说明**：业务计算 / AI 分析 / 联网搜索已全部下沉到前端（Web 与桌面共用同一份 `frontend/src`）；Node 为数据获取 + 驱动 Python + 本地数据代理的薄后端。仓库为**按职责平铺的 monorepo**（`service` / `frontend` / `python` / `tauri` / `docs` / `packages`），双部署目标：**Web**（浏览器）与**桌面**（Tauri 2 壳，仅解禁 CORS、不打包前端资源）。桌面壳见 [Tauri 2 桌面壳](docs/architecture/desktop-shell.md)。

## 🚀 功能特性

### 🤖 AI 智能投顾
*   **多分析师辩论**：四位专业 AI 分析师（业绩/持仓/经理/市场环境）并行评估，研究总监综合裁决。
*   **标准化 5 档评级**：基于结构化 JSON 输出的 Strong Buy→Sell 评级体系，可信度高。
*   **记忆反思系统**：每次分析决策自动存储，后续拉取实际收益并生成事后反思，注入未来分析。
*   **防幻觉设计**：预获取东方财富/财联社/百度股市通实时快讯及行业板块数据，直接注入 prompt。
*   **智能仪表盘**：通过 AI 对基金的业绩、管理能力、持仓及市场前景进行多维度打分。
*   **市场情绪摘要**：每日自动生成市场行情摘要，捕捉关键市场动态与板块机会。

### 📊 全面数据可视化
*   **基金详情页**：
    *   **基本信息**：实时净值、估算涨幅、费率结构等。
    *   **业绩走势**：多周期业绩趋势图，支持同类对比。
    *   **资产配置**：股票/债券/现金占比分析。
    *   **持仓透视**：前十大重仓股及其占比变化。
    *   **能力雷达**：直观展示基金的盈利能力、抗风险能力等 5 维指标。
*   **市场概览**：
    *   **全球行情**：上证、深证、纳指、恒生等主要指数实时行情。
    *   **贵金属追踪**：黄金、白银等大宗商品的历史走势与实时数据。

### 🛠 便捷工具
*   **基金搜索**：支持代码/名称快速搜索（ProviderChain 实时查询）。
*   **自选管理**：一键添加/移除自选基金，随时跟踪关注标的（数据存储在浏览器 IndexedDB）。
*   **定投回测**：通过 Python 脚本进行多策略回测（**每月/每周/每日定投、一次性买入 + 止盈止损**）。
*   **桌面端**：Tauri 2 桌面壳（Web 与桌面共用同一 frontend，桌面直连外部 API 不受 CORS 限制）。
*   **一键启动**：根目录 `npm run dev` 同时启动后端 + 前端。

### 📊 使用方法

#### （1）市场大盘页面

- 市场指数实时走势：展示了上证指数、深证成指、沪深300指数的当日走势。
- 全球行情板块：展示A股、港股、美股重要指数的走势。
- 近7日A股成交量：展示近7个交易日A股的成交量情况。
- 实时贵金属价格：展示黄金9999、现货黄金、现货白银的实时价格及走势。
-  7×24 快讯（右侧边栏）：展示实时重要新闻及其影响行业。
- 行业板块排行（右侧边栏）：展示当日强势板块和弱势板块、主力资金流动情况。

![市场大盘.png](https://github.com/Sebastian6848/GoFundBot/blob/master/docs/images/%E5%B8%82%E5%9C%BA%E5%A4%A7%E7%9B%98.png)

#### （2）基金详情页面

- 搜索基金代码或名称，可以显示基金的详细信息，辅助挑选基金。
- 左侧自选栏：可以将持有的基金添加自选，实时查询估值情况。
- 业绩走势：包含本基金的历史走势、与同类基金和沪深300指数的收益对比、最大回撤及修复情况。
- 同类排名走势：包含选定基金在同类基金中的收益排名情况。
- 资产配置、持有人结构、基金规模变动、申购赎回情况：反应基金持仓的变化与热门度。
- 基金经理能力评估：调用东方财富API，绘制经理能力雷达图。
- 同类基金涨幅榜：辅助挑选同类型优质基金。

![基金详情.png](docs/images/基金详情.png)

- 使用LLM辅助分析基金情况（结论仅供参考）

![LLM](docs/images/LLM分析.png)

#### （3）基金筛选

- 提供了4433法则、夏普比率、低波动策略等快速筛选策略，点击即可使用。
- 提供了自定义筛选条件的选择，可以根据基金类型、收益率、回撤等选项筛选基金。
- 风险指标（夏普/卡玛/波动率/最大回撤）由前端从 NAV 历史本地计算，不依赖服务端内存缓存。

![基金筛选.png](docs/images/基金筛选.png)

#### （4）基金对比

> [!NOTE]
>
> 最多支持5只基金同时对比，对比前需要先添加基金到自选页。

- 多维度对比基金的收益率、规模、回撤、经理能力等指标，辅助挑选基金。
- 对比最好在同类型基金中展开，跨板块对比意义不大。

![基金对比.png](docs/images/基金对比.png)

#### （5）定投回测

- 支持每月/每周/每日定投、一次性买入，可设置止盈/止损条件。
- 目前只支持单基回测，后续会加入组合回测。

![定投回测.png](docs/images/定投回测.png)

- 回测结果：

![回测结果.png](docs/images/回测结果.png)

#### （6）实时估值（新）

- 可以对持有的基金进行实时估值并计算当日盈亏

![实时估值](docs/images/实时估值.png)

#### （7）桌面端使用（Tauri 2 壳）

桌面壳仅解禁 CORS、不打包前端资源，**Node 与前端服务必须独立启动**，桌面 WebView 加载运行中的前端服务 origin。

```bash
# 1. 启动后端 + 前端（生产静态托管）
cd service && npm install && npm run build && npm start   # service :3100
cd frontend && npm run build && npm run preview            # 静态托管 :4173

# 2. 启动桌面壳（另开终端）
cd tauri && npm install && npm run dev                     # = tauri dev
```

> Linux 需系统库 `webkit2gtk-4.1` / `gtk3` / `atk`；`npm run dev`（根目录）默认加载 devUrl `http://localhost:5173`，`npm run build && npm run preview` 后加载 prod `http://localhost:4173`。详见文档站 [桌面壳](docs/architecture/desktop-shell.md)。

## 🛠 技术栈

### 后端 (service)
*   **语言**: Node.js / TypeScript
*   **框架**: Express
*   **数据源编排**: ProviderChain (stock-sdk → eastmoney → baidu/cls)
*   **缓存**: 内存 LRU, 分资源类型 TTL (30s ~ 7d)
*   **限流**: express-rate-limit (300/15min)
*   **安全头**: Helmet (CSP/COEP 禁用)
*   **输入校验**: Zod schemas
*   **Python Runner**: `child_process.spawn()` 驱动 Python CLI（回测 / `data_complete` 数据补全）
*   **筛选接口**: `/api/screening` 仅返回原始清单，富化（风险指标/行业分类/4433）在前端本地计算
*   **设置接口**: 最小化——仅下发 Proxy URL（LLM/搜索 Key 存前端）
*   **结构化日志**: JSON 格式 + `requestId` 链路追踪

### Python 计算层 (python)
*   **语言**: Python 3.11+
*   **回测引擎**: 定投模拟（月/周/日/一次性买入）+ 止盈止损
*   **数据获取**: akshare / 东方财富 eastmoney API（`data_complete.py`）
*   **风险指标 / 行业分类**: 已迁移前端（`industryClassifier.ts` + `number.ts`），Python 侧不再承担
*   **搜索**: 已迁移前端（`searchService.ts`），Python 侧不再承担

### 前端 (frontend)
*   **框架**: Vue 3 (Composition API + TypeScript, 全部 `<script setup lang="ts">`)
*   **构建工具**: Vite + vue-tsc (TypeScript typecheck)
*   **状态管理**: Pinia
*   **持久化**: Dexie.js (IndexedDB) — 所有用户数据 + 基金缓存
*   **业务计算**: `industryClassifier`（行业/类型分类）、`computeRiskMetricsLocal`（风险指标）、4433 排名、`researchComputation`（投研看板聚合）
*   **AI 客户端**: `llm.ts`（OpenAI 兼容直调，JSON + 流式）+ `fundAnalyst` / `portfolioAnalyst` / `strategyDraft` / `chatEngine`
*   **联网搜索**: `searchService.ts`（Exa → Bocha → Tavily → DuckDuckGo 多源降级）
*   **环境适配**: `httpClient.ts`（Web fetch ↔ Tauri `plugin-http`，绕 CORS）
*   **UI 组件**: 自定义响应式组件 + `@gofund/ui` 基础组件库
*   **可视化**: ECharts + vue-echarts
*   **测试**: Vitest + @vue/test-utils

### 桌面壳 (tauri)
*   **框架**: Tauri 2 + Rust（独立 npm 包 `gofund-tauri`，自带 `@tauri-apps/cli`）
*   **网络**: `tauri-plugin-http`（出站 HTTP 绕 CORS，直连 Node `localhost:3100`）
*   **IPC 放行**: `capabilities/remote-webview.json` 配置远程 origin
*   **前端资源**: 不打包——WebView 加载运行中的前端服务 origin

## 📋 环境准备

*   **Node.js 18+** 和 `npm`
*   **Python 3.11+**（运行回测/数据脚本，推荐使用 `python/.venv`）
*   **Git**（用于克隆仓库）
*   **桌面端（可选）**：Rust 1.77+；Linux 另需 `webkit2gtk-4.1` / `gtk3` / `atk`

## ⚡ 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/Sebastian6848/GoFundBot.git
cd GoFundBot
```

### 2. 安装依赖

```bash
# service（Express 后端）
cd service && npm install && cd ..

# frontend（Vue 前端）
cd frontend && npm install && cd ..

# Python 环境（推荐：一键建 venv 并安装 requirements + requirements-dev）
npm run setup:venv
# 备选：pip install -r python/requirements.txt

# tauri（桌面端，可选）
cd tauri && npm install && cd ..

# 根目录（一键启动脚本）
npm install
```

### 3. 配置环境变量

```bash
# service 配置（按需；LLM/Search Key 已迁移前端，不再需要 Node 侧配置）
cp service/.env.example service/.env
```

- **AI 配置**：浏览器访问 **设置 → AI 配置** 填写 API Key / Base / Model（默认 `https://api.siliconflow.cn/v1`、`Qwen/Qwen2.5-7B-Instruct`）。
- **搜索配置**：**设置 → 搜索** 填写 Bocha / Tavily Key（Exa 免费无需 Key）。
- **代理设置**：**设置 → 代理设置** 填写 Proxy URL（下发 Node，供 Yahoo Finance 抓取）。

> 密钥仅存于浏览器前端（localStorage），不落服务端。`service/.env` 仅按需配置 `HTTP_PROXY` / `HTTPS_PROXY`（访问 Yahoo Finance 国际 API 需要）。

### 4. 一键启动

```bash
npm run dev
```

同时启动：
- **service** (端口 3100) — Express 后端
- **frontend** (端口 5173) — Vue 开发服务器（代理 `/api` → 3100，`/docs` → 5174）
- **Docs** (端口 5174) — VitePress 文档站

启动成功后访问 `http://localhost:5173`，文档站通过前端 `/docs/*` 路径代理访问。

### 5. 桌面启动

```bash
# 先启动后端 + 前端（见上文「桌面端使用」），再启动桌面壳
npm run desktop:dev        # 等价：service + frontend + tauri dev 并行
```

### 6. 生产部署

**构建前端**

```bash
cd frontend && npm run build
```

**启动 service**

```bash
cd service && npm run build && npm start
```

前端构建产物在 `frontend/dist/`，可直接用 Nginx 托管，API 代理到 `http://localhost:3100`。

### 调用 Python 脚本

```bash
# 回测（统一使用 python/.venv/bin/python 前缀）
echo '{"fundCode":"019667","navHistory":[...]}' | python/.venv/bin/python python/cli/backtest.py

# 获取基金详情
python/.venv/bin/python python/cli/fetch_fund.py --code 019667

# 数据补全（akshare/eastmoney 拉取）
python/.venv/bin/python python/cli/data_complete.py --source akshare --type stocks
```

## 📂 项目结构

```text
GoFundBot/
├── service/                     # Express 薄后端（数据获取 + Python 驱动 + 数据代理）
│   ├── src/
│   │   ├── app.ts               # 应用入口 — 路由注册 + 中间件
│   │   ├── routes/              # API 路由（fund/market/screening/backtest/settings/...）
│   │   ├── services/            # 数据层服务（fundService, marketService, pythonRunner, ...）
│   │   ├── providers/           # 数据源（eastmoney, stock-sdk, tencent, yahoo, joinquant）
│   │   ├── core/                # 基础设施（logger, cache, errors, response, providerChain）
│   │   ├── types/               # DTO 类型定义
│   │   └── __tests__/           # 单元测试
│   └── package.json
├── frontend/                    # Vue 3 + TypeScript 前端（业务计算 / AI / 搜索全部在此）
│   ├── src/
│   │   ├── db/                  # Dexie.js IndexedDB schema
│   │   ├── components/          # Vue 组件
│   │   ├── composables/         # 组合式函数（useDexieCache, useFundWatchlist...）
│   │   ├── stores/              # Pinia 状态管理
│   │   ├── services/            # API 客户端 + 业务计算（llm, fundAnalyst, chatEngine, industryClassifier, searchService, httpClient...）
│   │   └── views/               # 页面视图
│   └── package.json
├── tauri/                        # Tauri 2 桌面壳（仅解禁 CORS，不打包前端）——独立 npm 包 gofund-tauri
│   ├── package.json              # 自带 @tauri-apps/cli（dev/build = tauri dev|build）
│   └── src-tauri/
│       ├── tauri.conf.json       # devUrl/frontendDist = 前端服务地址
│       ├── capabilities/         # remote-webview.json：远程 origin IPC 放行
│       ├── Cargo.toml + build.rs # Rust 项目
│       └── src/                  # main.rs / lib.rs（tauri + tauri-plugin-http）
├── packages/
│   └── ui/                       # UI 组件库 @gofund/ui（Vite lib mode 构建，组件级 chunk + dts）
├── python/                       # Python CLI 脚本（计算/数据补全）
│   ├── cli/                      # 可执行脚本
│   │   ├── backtest.py           # 定投回测（月/周/日/一次性 + 止盈止损）
│   │   ├── fetch_fund.py         # 基金数据拉取
│   │   ├── data_complete.py      # 数据补全（akshare/eastmoney 拉取）
│   │   ├── check_file_length.py  # 文件行数检查（CI）
│   │   └── _template.py          # 新脚本模板
│   ├── cli/shared/               # 共享 Python 库
│   │   ├── http_client.py        # HTTP 客户端
│   │   └── file_cache.py         # 文件缓存
│   ├── services/                 # Python 计算模块（backtest.py, helpers.py）
│   ├── providers/                # Python 数据源
│   ├── templates/                # 模板
│   ├── docs/                     # Python 相关文档
│   ├── Data/                     # 日志、缓存文件
│   ├── requirements.txt / requirements-dev.txt
│   ├── pyproject.toml
│   └── Dockerfile
├── docs/                        # VitePress 文档站 + 截图
├── package.json                 # 根目录 — 一键启动脚本
└── AGENTS.md                    # AI Agent 开发指南
```

## 🧩 UI 组件库抽离计划

为提升前端组件复用性，将 `frontend/src/components/` 中的自定义基础组件抽离为独立 UI 库（monorepo workspace 子包 `packages/ui`，包名 `@gofund/ui`，Vite lib mode 构建）。

| 状态 | 组件 | 说明 |
|------|------|------|
| ✅ 首批已抽离 | B* 系列表单控件 + 浮层/反馈组件 | 已迁至 `packages/ui`（Vite lib mode 构建，组件级 chunk + dts）：BButton、BInput、BInputNumber、BDatePicker、BTimePicker、BRadio、BRadioGroup、BCheckbox、BSwitch、BFileInput、BaseModal、BDialog、BCard、SkeletonCard、SkeletonChart、ErrorBoundary、OfflineBanner（含 LucideIcon、useOnlineStatus） |
| ⏳ 待后续处理 | AlertBadge、MobileDrawer、BottomNav、HamburgerButton | 与业务/路由耦合，需先解耦（详见下方分项说明） |

**待后续处理组件 —— 暂缓原因与解耦建议：**

- **AlertBadge**（告警铃铛）— 依赖 `alertStore`（Pinia）+ `useNotification`，需将告警规则数据抽象为 props/插槽外部注入后再抽离。
- **MobileDrawer**（移动端抽屉导航）— 硬编码路由导航项 + 依赖 `useRouter`，需将 `items` 导航配置改为外部 props 传入。
- **BottomNav**（移动端底部导航）— 依赖 `useRoute`/`useRouter`/`useBreakpoint`，导航项需外部注入。
- **HamburgerButton**（汉堡按钮）— 本身较纯（props: `isOpen` + emit: `toggle`），仅与 MobileDrawer 配套使用，建议随其一起迁移。

> 首批组件已抽离完成（`packages/ui`，包名 `@gofund/ui`，frontend 通过 `file:../packages/ui` 依赖 + Vite/TS 别名直接引用包源码）；
> 抽离进展持续同步更新本节；详细组件级文档见文档站 [`docs/ui/extraction-plan.md`](docs/ui/extraction-plan.md)。

## ⚠️ 已知限制

### Yahoo Finance API 需要代理

service 的全球指数历史 K 线通过 Yahoo Finance v8 API 获取。由于 Yahoo Finance 屏蔽中国大陆 IP，
需要配置 `HTTP_PROXY` / `HTTPS_PROXY` 代理环境变量才能正常访问。

配置方式（见 `service/.env.example`）：
```bash
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
```

### Push2 A 股全市场列表不可用

东方财富 `push2.eastmoney.com` 的 A 股全市场 filter 在当前服务环境被拒绝访问。受影响的 service 功能：

- **涨跌统计**（`GET /market/breadth`）→ 改用 `api/qt/stock/get?secid=1.000001` 的
  上证指数级字段作为近似替代，仅覆盖上证市场，不含深证。
- **涨停股池** → 不可用，Python 侧保留 akshare `stock_zt_pool_em` 作为唯一数据源。

### 全球指数历史 K 线

全球指数（美股/港股/日经/欧股等）的历史 K 线通过 Yahoo Finance v8 API 获取，
而非 EastMoney push2his（push2his 不支持全球指数 secid）。

### 今日资金流向（market money flow）

EastMoney `push2*` 子域名分订单规模（主力/超大单/大单/中单/小单）接口被反爬封锁，自动回退 Akshare
（`data_complete.py --source akshare --type money_flow`），两种数据源均失败时前端显示「暂无数据」。
大盘资金流向的获取与分类标准详见 [`docs/market-money-flow.md`](docs/market-money-flow.md)。

## 📝 免责声明

本项目所有数据均来自公开接口，仅供个人学习及参考使用。数据可能存在延迟，不作为任何投资建议。
