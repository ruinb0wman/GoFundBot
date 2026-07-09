# GoFundBot

[![CI](https://github.com/Sebastian6848/GoFundBot/actions/workflows/ci.yml/badge.svg)](https://github.com/Sebastian6848/GoFundBot/actions/workflows/ci.yml)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)]() [![Vue.js](https://img.shields.io/badge/Vue.js-3-green.svg)]()

GoFundBot 是一个基于 Node.js (Express) 和 Vue 3 构建的智能基金分析与可视化工具。它不仅提供实时的基金数据查询和可视化图表，还集成了先进的 AI 大模型（LLM），为用户提供深度的基金投资分析、风险评估及市场研判报告。所有持久化数据存储在浏览器端 IndexedDB（Dexie.js）中，服务端无状态。

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
*   **定投回测**：通过 Python 脚本进行多策略定投模拟（月定投/周定投/MA 均线/价值平均）。
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

![基金筛选.png](docs/images/基金筛选.png)

#### （4）基金对比

> [!NOTE]
>
> 最多支持5只基金同时对比，对比前需要先添加基金到自选页。

- 多维度对比基金的收益率、规模、回撤、经理能力等指标，辅助挑选基金。
- 对比最好在同类型基金中展开，跨板块对比意义不大。

![基金对比.png](docs/images/基金对比.png)

#### （5）定投回测

- 目前只支持单基回测，后续会加入组合回测。

![定投回测.png](docs/images/定投回测.png)

- 回测结果：

![回测结果.png](docs/images/回测结果.png)

#### （6）实时估值（新）

- 可以对持有的基金进行实时估值并计算当日盈亏

![实时估值](docs/images/实时估值.png)

## 🛠 技术栈

### 后端 (Service)
*   **语言**: Node.js / TypeScript
*   **框架**: Express
*   **数据源编排**: ProviderChain (stock-sdk → eastmoney → baidu/cls)
*   **缓存**: 内存 LRU, 分资源类型 TTL (30s ~ 7d)
*   **限流**: express-rate-limit (300/15min)
*   **安全头**: Helmet (CSP/COEP 禁用)
*   **输入校验**: Zod schemas
*   **AI/LLM**: OpenAI SDK (Node.js), SSE 流式输出
*   **分析引擎**: 4 分析师并行（performance/holding/manager/market）+ Supervisor 合成
*   **Python Runner**: `child_process.spawn()` 调用 Python CLI 脚本（回测/风险计算）
*   **结构化日志**: JSON 格式 + `requestId` 链路追踪

### Python 计算层 (Scripts)
*   **语言**: Python 3.11+
*   **回测引擎**: 定投模拟（月/周/MA均线/价值平均）+ 策略推荐
*   **数据获取**: akshare / 东方财富 eastmoney API
*   **风险计算**: 夏普比率 / 最大回撤 / 波动率 / 年化收益
*   **行业分类**: 基金名称规则匹配 → 行业标签

### 前端 (Frontend)
*   **框架**: Vue 3 (Composition API + TypeScript, 全部 `<script setup lang="ts">`)
*   **构建工具**: Vite + vue-tsc (TypeScript typecheck)
*   **状态管理**: Pinia
*   **持久化**: Dexie.js (IndexedDB) — 所有用户数据 + 基金缓存
*   **UI 组件**: 自定义响应式组件 (FundDetail, MarketOverview 等)
*   **可视化**: ECharts + vue-echarts
*   **测试**: Vitest + @vue/test-utils

## 📋 环境准备

*   **Node.js 18+** 和 `npm`
*   **Python 3.11+**（运行回测/数据脚本）
*   **Git**（用于克隆仓库）

## ⚡ 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/Sebastian6848/GoFundBot.git
cd GoFundBot
```

### 2. 安装依赖

```bash
# Service（Express 后端）
cd Service && npm install && cd ..

# Frontend（Vue 前端）
cd Frontend && npm install && cd ..

# Python 脚本依赖
cd Scripts && pip install -r requirements.txt && cd ..


# 根目录（一键启动脚本）
npm install
```

### 3. 配置环境变量

```bash
# Service 配置
cp Service/.env.example Service/.env

# LLM API（选填，用于 AI 分析功能）
# 编辑 Service/.env，配置 API Key：
LLM_API_KEY=your_api_key_here
LLM_API_BASE=https://api.siliconflow.cn/v1
LLM_MODEL=deepseek-ai/DeepSeek-R1-Distill-Qwen-32B
```

### 4. 一键启动

```bash
npm run dev
```

同时启动：
- **Service** (端口 3100) — Express 后端
- **Frontend** (端口 5173) — Vue 开发服务器

启动成功后访问 `http://localhost:5173`。

### 5. 生产部署

**构建前端**

```bash
cd Frontend && npm run build
```

**启动 Service**

```bash
cd Service && npm run build && npm start
```

前端构建产物在 `Frontend/dist/`，可直接用 Nginx 托管，API 代理到 `http://localhost:3100`。

### 调用 Python 脚本

```bash
# 回测
echo '{"fundCode":"019667","navHistory":[...]}' | python Scripts/cli/backtest.py

# 获取基金详情
python Scripts/cli/fetch_fund.py --code 019667

# 计算风险指标
echo '{"navHistory":[...]}' | python Scripts/cli/compute_risk.py
```

## 📂 项目结构

```text
GoFundBot/
├── Service/                     # Express 后端（主服务）
│   ├── src/
│   │   ├── app.ts               # 应用入口 — 路由注册 + 中间件
│   │   ├── routes/              # API 路由（fund/market/screening/backtest/...）
│   │   ├── services/            # 业务逻辑（fundService, pythonRunner, aiAnalyst）
│   │   ├── providers/           # 数据源（eastmoney, stock-sdk, tencent, yahoo）
│   │   ├── core/                # 基础设施（logger, cache, errors, response）
│   │   ├── types/               # DTO 类型定义
│   │   └── __tests__/           # 单元测试（67+ 条）
│   ├── prompts/                 # AI analyst prompt 模板
│   └── package.json
├── Frontend/                    # Vue 3 + TypeScript 前端
│   ├── src/
│   │   ├── db/                  # Dexie.js IndexedDB schema
│   │   ├── components/          # Vue 组件
│   │   ├── composables/         # 组合式函数（useDexieCache, useFundWatchlist...）
│   │   ├── stores/              # Pinia 状态管理
│   │   ├── services/            # API 客户端
│   │   └── views/               # 页面视图
│   └── package.json
├── Scripts/                     # Python CLI 脚本（计算/数据补全）
│   ├── cli/                     # 可执行脚本
│   │   ├── backtest.py          # 定投回测
│   │   ├── fetch_fund.py        # 基金数据拉取
│   │   ├── fetch_market.py      # 市场数据拉取
│   │   ├── compute_risk.py      # 风险指标计算
│   │   ├── classify_industry.py # 行业分类
│   │   └── memory_reflect.py    # 分析记忆反思
│   ├── cli/shared/              # 共享 Python 库
│   │   └── http_client.py       # HTTP 客户端
│   ├── services/                # Python 计算模块（backtest.py, risk_metrics.py...）
│   ├── providers/               # Python 数据源（eastmoney.py, tencent.py）
│   ├── Data/                    # 日志、缓存文件
│   └── requirements.txt
├── docs/                        # 文档和截图
├── package.json                 # 根目录 — 一键启动脚本
└── AGENTS.md                    # AI Agent 开发指南
```

## ⚠️ 已知限制

### Yahoo Finance API 需要代理

Service 的全球指数历史 K 线通过 Yahoo Finance v8 API 获取。由于 Yahoo Finance 屏蔽中国大陆 IP，
需要配置 `HTTP_PROXY` / `HTTPS_PROXY` 代理环境变量才能正常访问。

配置方式（见 `Service/.env.example`）：
```bash
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
```

### Push2 A 股全市场列表不可用

东方财富 `push2.eastmoney.com` 的 A 股全市场 filter 在当前服务环境被拒绝访问。受影响的 Service 功能：

- **涨跌统计**（`GET /market/breadth`）→ 改用 `api/qt/stock/get?secid=1.000001` 的
  上证指数级字段作为近似替代，仅覆盖上证市场，不含深证。
- **涨停股池** → 不可用，Scripts 保留 akshare `stock_zt_pool_em` 作为唯一数据源。

### 全球指数历史 K 线

全球指数（美股/港股/日经/欧股等）的历史 K 线通过 Yahoo Finance v8 API 获取，
而非 EastMoney push2his（push2his 不支持全球指数 secid）。

### 个股资金流向说明

个股资金流向数据通过 EastMoney push2 `fflow/daykline/get` 接口获取。
字段含义：
- 主力净流入 = 超大单净流入 + 大单净流入（≈ 机构资金）
- 中单净流入 ≈ 大户资金
- 小单净流入 ≈ 散户资金
- 数值单位为元，Service 返回原始值。

## 📝 免责声明

本项目所有数据均来自公开接口，仅供个人学习及参考使用。数据可能存在延迟，不作为任何投资建议。
