# GoFundBot

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)]() [![Vue.js](https://img.shields.io/badge/Vue.js-3-green.svg)]()

GoFundBot 是一个本机跑的基金分析与可视化工具：Node 后端负责数据获取、存储与计算，Vue 3 前端负责展示与工作台，**AI 由终端 [pi](https://github.com/earendil-works/pi) 承担**（应用本身不接入任何大模型、不持有任何密钥）。

**架构说明**：`service`（Node + SQLite）是数据、用户数据与工具面的唯一真源；计算内核 `packages/core` 由前后端共用同一份源码；前端只做展示与工作台。仓库为**按职责平铺的 monorepo**（`service` / `frontend` / `packages` / `python` / `docs`），桌面端由外部 Electron 浏览器壳解禁 CORS，前端同一份代码直出、无任何运行时分支。详见 [Node 核心架构](docs/architecture/node-core.md)。

## 🚀 功能特性

### 🤖 AI 由终端 pi 承担
*   **工具面单一真源**：`GET /api/agent/tools` 提供 **39 个工具**（行情/板块/资金流/基金/快讯 + 自选 + 告警 + 回测 + 筛选 + 投研看板 + 策略/方案/持仓），pi 扩展启动时拉清单动态注册。
*   **同源同值**：工具处理器直接调 service 内部函数（同一份 core 引擎、同一份 SQLite 缓存），所以模型看到的数字与页面一致。
*   **执行/写入要确认**：`save_strategy`、`run_strategy_code`、`save_strategy_script` 第一次调用只返回确认令牌，用户确认并原样重调才真正执行。
*   **自由代码回测**：pi 可以写策略代码（`prepare(sdk)` 声明池、`onDay(s)` 逐日决策）并直接跑出结果；在 `node:worker_threads` 沙箱里执行，5s 超时强制终止。
*   **零密钥**：应用不存 LLM key；唯一的"AI 相关"服务端能力是无需 key 的搜索 `POST /api/search`（Exa → DuckDuckGo）。

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
*   **自选管理**：一键添加/移除自选基金，随时跟踪关注标的（数据存在 service SQLite）。
*   **代码优先回测**：`prepare/onDay` 自由策略代码（也可用页面模板），单基金 + 多资产组合 + 再平衡 + 现金腿；引擎在 `packages/core`，前端与 service 同源同值。
*   **桌面端**：支持 Electron 浏览器壳（壳侧解禁 CORS，直连 Node / 外部 API 不受浏览器限制）。
*   **一键启动**：根目录 `bun dev` 同时启动后端 + 前端 + 文档站。

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

- 需要 AI 分析时：在仓库目录起一个终端 `pi` 会话，让它用 `get_fund_detail` / `run_backtest` / `list_strategies` 等工具回答（截图见 [pi 工具面](docs/architecture/pi-tools.md)）。

#### （3）基金筛选

- 提供了4433法则、夏普比率、低波动策略等快速筛选策略，点击即可使用。
- 提供了自定义筛选条件的选择，可以根据基金类型、收益率、回撤等选项筛选基金。
- 数据与富化都在 service（SQLite `screening_funds`）：刷新时算好风险指标/行业标签/4433 排名，页面与 pi 共用同一份结果。

![基金筛选.png](docs/images/基金筛选.png)

#### （4）基金对比

> [!NOTE]
>
> 最多支持5只基金同时对比，对比前需要先添加基金到自选页。

- 多维度对比基金的收益率、规模、回撤、经理能力等指标，辅助挑选基金。
- 对比最好在同类型基金中展开，跨板块对比意义不大。

![基金对比.png](docs/images/基金对比.png)

#### （5）定投回测

- 代码优先的工作台：`prepare(sdk)` 声明固定标的池（可用 `sdk.screen()` 从本地基金库筛选），`onDay(s)` 按基金代码逐日决策。
- 支持单基金定投/价值平均/均线偏离、多资产权重 + 日历/阈值再平衡 + 定期注水 + 现金腿；也可让 pi 直接跑（`run_strategy_code`）。

![定投回测.png](docs/images/定投回测.png)

- 回测结果：

![回测结果.png](docs/images/回测结果.png)

#### （6）实时估值（新）

- 可以对持有的基金进行实时估值并计算当日盈亏

![实时估值](docs/images/实时估值.png)

#### （7）桌面端使用（Electron 浏览器壳）

桌面端由外部 Electron 浏览器壳提供（壳侧禁用 Web Security / 解禁 CORS）。前端无需任何适配——按 Web 方式部署即可：Electron 壳加载运行中的前端 dev 服务，Node API 以普通 `fetch` 直连（壳侧解禁 CORS）。

```bash
# 1. 启动后端 + 前端 dev + 文档站
cd service && bun install && bun run dev    # service :8310
cd frontend && bun install && bun run dev   # 前端 :8517（/api 代理 → 8310，/docs 代理 → 8574）
cd docs && bun install && bunx vitepress dev --port 8574   # 文档站 :8574

# 2. 用 Electron 浏览器壳打开 http://localhost:8517
```

## 🛠 技术栈

### 后端 (service)
*   **语言**: Node.js / TypeScript
*   **框架**: Express
*   **数据源编排**: ProviderChain (行情 stock-sdk → eastmoney；基金 joinquant → tencent → stock-sdk → eastmoney)，失败落 Python/akshare
*   **存储**: SQLite (`node:sqlite`) — 用户数据 / 筛选库 / 净值缓存 / 设置，见 `src/db/migrations/`
*   **计算**: 调 `packages/core`（回测 / 组合 / 风险指标 / 行业分类 / 4433 / 投研聚合）
*   **工具面**: `/api/agent/tools`（39 个工具，Zod → JSON Schema）+ `/api/agent/call`（写/执行类需确认令牌）
*   **代码沙箱**: `node:worker_threads`（5s 超时 terminate）
*   **缓存**: 内存 LRU (30s ~ 7d) + SQLite 净值缓存（带覆盖度判断）
*   **限流**: express-rate-limit (300/15min)
*   **安全头**: Helmet (CSP/COEP 禁用)
*   **输入校验**: Zod schemas
*   **Python Runner**: `child_process.spawn()` 驱动 Python CLI（只做数据补全）
*   **筛选接口**: `/api/screening/{sync,compute,ranks,query,status,industry-tags,screen-rows}` —— 拉清单 + 富化 + 查询都在 service
*   **设置接口**: 最小化——仅下发 Proxy URL（应用不持有任何密钥）
*   **结构化日志**: JSON 格式 + `requestId` 链路追踪

### Python 计算层 (python)
*   **语言**: Python 3.11+
*   **职责**: 只做数据补全 —— `data_complete.py`（akshare/eastmoney）、`fetch_fund.py`（单只基金）
*   **回测引擎**: 已迁到 `packages/core/src/backtest/`（TS），Python 侧不再承担
*   **风险指标 / 行业分类 / 搜索**: 分别在 `packages/core` 与 `service/src/ai/search.ts`，Python 侧不再承担

### 前端 (frontend)
*   **框架**: Vue 3 (Composition API + TypeScript, 全部 `<script setup lang="ts">`)
*   **构建工具**: Vite + vue-tsc (TypeScript typecheck)
*   **状态管理**: Pinia
*   **持久化**: 用户数据/缓存都在 service SQLite；前端已无 Dexie/IndexedDB（旧数据仍在浏览器里，但不再读）
*   **业务计算**: 来自 `@gofund/core`（与 service 共用同一份源码）；页面只做展示与交互
*   **AI / 搜索客户端**: 无 —— 前端没有聊天或 AI 入口，AI 交互在终端 pi
*   **环境适配**: `httpClient.ts`（统一浏览器 fetch；Electron 壳侧解禁 CORS）
*   **UI 组件**: 自定义响应式组件 + `@gofund/ui` 基础组件库
*   **可视化**: ECharts + vue-echarts
*   **测试**: Vitest + @vue/test-utils

## 📋 环境准备

*   **Node.js 22.19+**（下限由运行时依赖 `undici@8` 决定，见各 `package.json` 的 `engines`）和 `bun`
*   **Python 3.11+**（运行回测/数据脚本，推荐使用 `python/.venv`）
*   **Git**（用于克隆仓库）
*   **桌面端（可选）**：外部 Electron 浏览器壳（无需额外依赖）

## ⚡ 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/Sebastian6848/GoFundBot.git
cd GoFundBot
```

### 2. 安装依赖

**一键安装（推荐）**——根目录脚本会装齐四个 Node 子项目 + Python venv + git 钩子：

```bash
./setup.sh            # 等价于 bun run setup（npm run setup 亦可）
./setup.sh --help     # 选项：--skip-node / --skip-python
```

Node 侧统一使用 **bun**（与 `bun dev` 一致）；`packages/ui` 会先于 `frontend` 安装（后者依赖 `@gofund/ui: file:../packages/ui`）。仓库只跟踪 `bun.lock`（已删 `package-lock.json`），所以下面的 npm 路径能装上但**不锁定版本**：

```bash
# service（Express 后端）
cd service && npm install && cd ..

# frontend（Vue 前端）
cd frontend && npm install && cd ..

# Python 环境（一键建 venv 并安装 requirements + requirements-dev）
npm run setup:venv
# 备选：pip install -r python/requirements.txt

# 安装 git 钩子（pre-commit 二进制随 setup:venv 装入 python/.venv）
python/.venv/bin/pre-commit install --install-hooks

# 根目录（一键启动脚本）
npm install
```

### 3. 配置环境变量

```bash
# service 配置（按需；应用不持有任何 LLM/搜索密钥）
cp service/.env.example service/.env
```

- **AI 配置**：没有。AI 在终端 pi 侧（用你自己的 pi 配置与密钥），应用不接入 LLM。
- **代理设置**：页面 **设置 → 代理设置** 填写 Proxy URL（下发给 Node，供 Yahoo Finance 抓取；国内接口一律直连）。

> `service/.env` 仅按需配置 `HTTP_PROXY` / `HTTPS_PROXY`、`HOST`、`GOFUND_DB_PATH` 等（见 `service/.env.example`）。

### 4. 一键启动

```bash
bun dev        # 等价于 bun run dev
```

同时启动：
- **service** (端口 8310) — Express 后端
- **frontend** (端口 8517) — Vue 开发服务器（代理 `/api` → 8310，`/docs` → 8574）
- **Docs** (端口 8574) — VitePress 文档站

启动成功后访问 `http://localhost:8517`，文档站通过前端 `/docs/*` 路径代理访问。

### 5. 桌面启动

```bash
# 用 Electron 浏览器壳（外部项目）打开已启动的前端 dev 服务即可：
# http://localhost:8517
```

### 调用 Python 脚本

```bash
# 获取基金详情
python/.venv/bin/python python/cli/fetch_fund.py --code 019667

# 数据补全（akshare/eastmoney 拉取）
python/.venv/bin/python python/cli/data_complete.py --source akshare --type stocks
```

### 本地校验（无 CI）

改完代码跑一条命令（service + frontend + docs，约 1 分钟）：

```bash
bun run check        # lint / typecheck / test / build 全跑一遍
bun run gen:tools    # 改了 service/src/agent/ 必须重跑（静态工具清单，漂移会被单测拦住）
```

## 📂 项目结构

```text
GoFundBot/
├── service/                     # Node 后端（数据 + 存储 + 计算 + 工具面）
│   ├── src/
│   │   ├── app.ts               # 应用入口 — 路由注册 + 中间件
│   │   ├── routes/              # API 路由（fund/market/screening/backtest/research/agent/...）
│   │   ├── services/            # 数据与计算服务（fundService, screeningService, backtestService, navCacheService, userDataService...）
│   │   ├── agent/               # pi 工具注册表（39 个工具 + 确认令牌）
│   │   ├── sandbox/             # 策略代码沙箱（node:worker_threads）
│   │   ├── db/                  # SQLite 连接 + 迁移（001~006）
│   │   ├── providers/           # 数据源（eastmoney, stock-sdk, tencent, yahoo, joinquant）
│   │   ├── core/                # 基础设施（logger, cache, errors, response, providerChain）
│   │   └── __tests__/           # 单元测试
│   └── package.json
├── frontend/                    # Vue 3 + TypeScript 前端（展示与工作台）
│   ├── src/
│   │   ├── db/                  # 服务端数据客户端的薄封装（无 Dexie）
│   │   ├── types/               # 记录形状（records.ts）
│   │   ├── components/          # Vue 组件
│   │   ├── composables/         # 组合式函数（useFundScreening, useResearchDashboard...）
│   │   ├── stores/              # Pinia 状态管理
│   │   ├── services/            # API 客户端（api/httpClient/userDataApi/screeningRows...）
│   │   └── views/               # 页面视图
│   └── package.json
├── packages/
│   ├── core/                     # 共享计算内核 @gofund/core（回测/组合/风险/分类/4433/投研聚合）
│   └── ui/                       # UI 组件库 @gofund/ui（Vite lib mode 构建，组件级 chunk + dts）
├── .pi/                          # 终端 pi 的工具桥扩展与技能
├── python/                       # Python CLI 脚本（数据补全）
│   ├── cli/                      # 可执行脚本
│   │   ├── fetch_fund.py         # 基金数据拉取
│   │   ├── data_complete.py      # 数据补全（akshare/eastmoney 拉取）
│   │   ├── check_file_length.py  # 文件行数检查（单文件 ≤500 行）
│   │   └── _template.py          # 新脚本模板
│   ├── cli/shared/               # 共享 Python 库
│   │   └── file_cache.py         # 文件缓存
│   ├── docs/                     # Python 相关文档
│   ├── Data/                     # 日志、缓存文件
│   ├── requirements.txt / requirements-dev.txt
│   ├── pyproject.toml
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

### Push2 A 股全市场列表（clist/get 全市场 filter）不可用

东方财富 `push2.eastmoney.com` 的 A 股全市场 `clist/get` filter 在当前服务环境被拒绝访问，
因此不能靠它逐只遍历统计全市场。**这不影响涨跌统计**：

- **涨跌家数**（`GET /market/breadth`）→ 用 `api/qt/ulist.np/get` 的指数级字段 `f104/f105/f106`
  （上涨/下跌/平盘）：上证指数 `1.000001` = 沪市全体、深证成指 `0.399001` = 深市全体，两者相加即沪深两市合计。
  实现见 `service/src/providers/eastmoney/marketBreadth.ts`。
- **涨跌停家数** → 用 `push2ex.eastmoney.com` 的涨/跌停池（`getTopicZTPool` / `getTopicDTPool`）的 `tc`，
  必须带 `date=YYYYMMDD`；取不到时返回 `null`（不再填假值）。
- 注意：`api/qt/stock/get` 的 `f168/f169/f170/f171` 是**换手率/涨跌额/涨跌幅/振幅**（不传 `fltt=2` 时放大 100 倍），
  `f292/f293` 也与涨跌停无关 —— 早期实现误用过这两组字段。

### 全球指数历史 K 线

全球指数（美股/港股/日经/欧股等）的历史 K 线通过 Yahoo Finance v8 API 获取，
而非 EastMoney push2his（push2his 不支持全球指数 secid）。

### 今日资金流向（market money flow）

EastMoney `push2*` 子域名分订单规模（主力/超大单/大单/中单/小单）接口被反爬封锁，自动回退 Akshare
（`data_complete.py --source akshare --type money_flow`），两种数据源均失败时前端显示「暂无数据」。
大盘资金流向的获取与分类标准详见 [`docs/market-money-flow.md`](docs/market-money-flow.md)。

## 📝 免责声明

本项目所有数据均来自公开接口，仅供个人学习及参考使用。数据可能存在延迟，不作为任何投资建议。
