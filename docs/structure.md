# GoFundBot 系统架构文档

> 本文档使用 Mermaid 图表描述 GoFundBot 的整体架构、前端架构、后端架构、AI 架构及数据流。

---

## 1. 系统总体架构

三服务独立部署，通过 HTTP REST JSON 通信：

```mermaid
flowchart LR
    subgraph 外部依赖
        LLM[LLM API<br/>SiliconFlow / DeepSeek / Qwen]
        SE[搜索引擎 API<br/>SerpAPI / Bing]
    end

    subgraph 用户端
        U[用户浏览器]
    end

    subgraph 前端层_Frontend
        VITE[Vite Dev Server<br/>端口 5173]
        VUE[Vue 3 App<br/>Pinia + Router + i18n]
    end

    subgraph 业务层_Scripts
        FLASK[Flask App<br/>端口 5000<br/>threaded=True]
        BP[13 个 Blueprint<br/>路由注册]
        SVC[服务层<br/>ServiceClient / AIService / ...]
        DB[(SQLite<br/>funds.db)]
    end

    subgraph 数据网关_Service
        EXP[Express App<br/>端口 3100]
        PC[ProviderChain<br/>多数据源迭代]
        CACHE[(内存缓存<br/>30s ~ 7d TTL)]
    end

    subgraph 外部数据源
        SS[stock-sdk]
        EM[eastmoney]
        TC[tencent]
        AK[akshare<br/>备用]
    end

    U -->|浏览器访问| VITE
    VITE -->|/api/* 代理| FLASK
    VITE -->|/sqlite-admin 代理| FLASK
    FLASK -->|请求转发| EXP
    EXP --> SS
    EXP --> EM
    EXP --> TC
    FLASK -->|备用路径| AK
    FLASK --> LLM
    FLASK --> SE
    FLASK --> DB
```

### 环境变量控制

| 变量 | 作用 |
|------|------|
| `FUND_DEFAULT_SOURCE` | 数据源策略：`data_service` / `auto` / `legacy` |
| `CORS_ORIGINS` | 跨域白名单 |
| `ENABLE_SQLITE_ADMIN` | SQLite 管理后台开关 |
| `DISABLE_AKSHARE_FALLBACK` | 禁用 akshare 备用路径 |

---

## 2. 前端架构

### 2.1 技术栈

- **框架**: Vue 3 (Composition API, `<script setup lang="ts">`)
- **构建**: Vite 5
- **路由**: Vue Router (Hash 模式)
- **状态管理**: Pinia
- **国际化**: vue-i18n (zh-CN / en)
- **UI 组件**: VXETable, ECharts, Lucide Icons
- **HTTP**: Axios

### 2.2 应用壳结构

```mermaid
flowchart TD
    APP[App.vue] --> OB[OfflineBanner<br/>离线提示]
    APP --> HEADER[Header]
    APP --> MAIN[Main Content]
    APP --> FOOTER[Footer]
    APP --> MD[MobileDrawer<br/>移动端抽屉]
    APP --> BN[BottomNav<br/>移动端底部导航]
    APP --> CB[ChatBubble<br/>AI 聊天入口]

    HEADER --> FS[FundSearch<br/>基金搜索]
    HEADER --> NAV[导航按钮组]
    HEADER --> AB[AlertBadge<br/>告警徽章]
    HEADER --> SETTINGS[设置入口]

    MAIN --> LAYOUT{路由 meta.rightbar}
    LAYOUT -->|true| C3[三栏布局]
    LAYOUT -->|false| FULL[全宽单栏]

    C3 --> SB[左侧 FundWatchlist<br/>自选列表]
    C3 --> RV[居中 &lt;router-view&gt;]
    C3 --> RB[右侧面板<br/>FlashNews + SectorRank]
    RV --> FC[FundComparison<br/>基金对比浮层]
```

### 2.3 路由配置

| 路径 | 视图组件 | 布局 | 说明 |
|------|----------|------|------|
| `/` | `DashboardView` | 三栏 | 市场仪表盘 |
| `/fund/:code` | `FundDetailView` | 三栏 | 基金详情 |
| `/index/:code` | `IndexDetailView` | 三栏 | 指数详情 |
| `/screening` | `ScreeningView` | 全宽 | 基金筛选 |
| `/backtest/:code?` | `BacktestView` | 全宽 | 定投回测 |
| `/portfolio` | `PortfolioView` | 全宽 | 我的持仓 |
| `/research` | `ResearchView` | 全宽 | 投研中心 |
| `/settings` | `SettingsView` | 全宽 | 嵌套设置页 |

### 2.4 Pinia Store

```mermaid
flowchart LR
    subgraph Stores_状态仓库
        FUND[fundStore<br/>基金数据]
        MARKET[marketStore<br/>市场数据]
        WATCH[watchlistStore<br/>自选管理]
        ALERT[alertStore<br/>告警规则]
        CHAT[chatStore<br/>AI 会话]
    end

    subgraph Views_视图层
        DASH[DashboardView]
        DETAIL[FundDetailView]
        SCREEN[ScreeningView]
        BT[BacktestView]
        RS[ResearchView]
    end

    DASH --> FUND
    DASH --> MARKET
    DASH --> WATCH

    DETAIL --> FUND
    DETAIL --> MARKET

    SCREEN --> FUND

    BT --> FUND

    RS --> MARKET
    RS --> FUND

    CHAT --> CHAT
    ALERT --> ALERT
```

### 2.5 Composables 分类

```mermaid
flowchart TD
    subgraph 基金相关
        FA1[useFundRealtime<br/>实时估值]
        FA2[useFundAIAnalysis<br/>AI 分析]
        FA3[useFundBacktest<br/>定投回测]
        FA4[useFundChart<br/>图表数据]
        FA5[useFundComparison<br/>基金对比]
        FA6[useFundDetail<br/>基金详情]
        FA7[useFundScreening<br/>基金筛选]
        FA8[useFundWatchlist<br/>自选操作]
    end

    subgraph 市场相关
        MA1[useMarketOverview<br/>市场概况]
        MA2[useResearchDashboard<br/>投研面板]
        MA3[useMyPositions<br/>我的持仓]
    end

    subgraph UI 工具
        UI1[useOnlineStatus<br/>网络状态]
        UI2[useBreakpoint<br/>响应式断点]
        UI3[useChartResize<br/>图表缩放]
        UI4[useEChartsTheme<br/>ECharts 主题]
        UI5[useTheme<br/>深色/浅色]
        UI6[useNotification<br/>通知提示]
        UI7[useDebouncedWatch<br/>防抖监听]
    end

    subgraph 其他
        O1[useSearchHistory<br/>搜索历史]
        O2[useStockPopup<br/>股票弹窗]
        O3[useApp<br/>App 核心逻辑]
    end
```

### 2.6 API 服务层

```mermaid
flowchart LR
    subgraph services_API客户端
        API[api.ts<br/>Axios 实例]
        CHAT_API[chatApi.ts<br/>聊天 API]
        PORT_API[portfolioApi.ts<br/>持仓 API]
    end

    API --> FUND_API[fundAPI<br/>基金 CRUD]
    API --> WATCH_API[watchlistAPI<br/>自选 CRUD]
    API --> SCREEN_API[screeningAPI<br/>筛选查询]
    API --> BT_API[backtestAPI<br/>回测接口]
    API --> MARKET_API[marketAPI<br/>市场数据]
    API --> RS_API[researchAPI<br/>投研数据]
    API --> ALERT_API[alertAPI<br/>告警 CRUD]
    API --> PORT_API

    API -->|baseURL: /api<br/>Vite 代理→:5000| FLASK
```

---

## 3. 后端架构

### 3.1 Flask Blueprint 注册全景

```mermaid
flowchart TD
    APP[app.py<br/>Flask 应用入口] --> MIDDLEWARE[中间件栈]

    subgraph MIDDLEWARE_中间件
        M1[CORS<br/>跨域]
        M2[Compress<br/>响应压缩]
        M3[Flask-Limiter<br/>速率限制]
        M4[before_request<br/>请求计时]
        M5[after_request<br/>Prometheus + 缓存头]
    end

    APP --> BP[13 个 Blueprint 注册]

    subgraph BP_Blueprint列表
        FD[fund_bp<br/>/api/fund/*]
        SC[screening_bp<br/>/api/screening/*]
        MK[fund_master_bp<br/>/api/market/*]
        DS[data_service_bp<br/>/api/data-service/*]
        WL[watchlist_bp<br/>/api/watchlist/*]
        RS[research_bp<br/>/api/research/*]
        BT[backtest_bp<br/>/api/backtest/*]
        AL[alert_bp<br/>/api/alerts/*]
        CH[chat_bp<br/>/api/chat/*]
        PF[user_portfolio_bp<br/>/api/portfolio/*]
        LG[log_bp<br/>/api/logs/*]
        SYS[system_bp<br/>/health + /metrics]
        V1[api_v1<br/>/api/v1/*]
    end
```

### 3.2 路由包详解

```mermaid
flowchart TD
    subgraph fund_routes_基金路由包
        FD_INIT[__init__.py]
        FD_DETAIL[detail.py<br/>基金详情 + 数据源选择]
        FD_ANALYZE[analyze.py<br/>AI 分析 + SSE 流式]
        FD_COMPARE[compare.py<br/>基金对比]
        FD_SEARCH[search.py<br/>基金搜索]
        FD_MARKET[market.py<br/>市场行情]
        FD_HELP[helpers.py<br/>数据源质量门控]
    end

    subgraph screening_routes_筛选路由包
        SC_INIT[__init__.py]
        SC_TASKS[tasks.py<br/>筛选任务]
        SC_QUERY[query.py<br/>筛选查询]
        SC_IND[industry.py<br/>行业分类]
    end

    subgraph routes_v1_API版本
        V1_INIT[__init__.py<br/>渐进式迁移]
        V1_FUND[fund.py<br/>v1 基金接口]
    end

    subgraph user_portfolio_持仓包
        PF_INIT[__init__.py]
    end
```

### 3.3 服务层全景

```mermaid
flowchart TD
    subgraph 核心服务
        DSC[data_service_client.py<br/>Service HTTP 客户端]
        DSLM[data_service_legacy_mapper.py<br/>响应格式映射]
        ES[estimate_service.py<br/>实时估值管理]
        AS[ai_service.py<br/>AI 分析编排]
        ML[memory_log.py<br/>分析记忆日志]
    end

    subgraph 回测与风险
        BTS[backtest_strategies.py<br/>定投策略推荐]
        BT[backtest.py<br/>回测模拟]
        RM[risk_metrics.py<br/>风险指标计算]
    end

    subgraph 服务子包
        FA[fund_analysts/<br/>多分析师 AI 流水线]
        AA[ai_agent/<br/>AI 聊天 Agent]
        RS2[research/<br/>投研服务]
        SE[screening_engine/<br/>筛选引擎]
        MD[maket_data/<br/>市场数据服务]
        FI[fund_industry/<br/>基金行业分类]
        FMS[fund_master_service/<br/>大盘服务-旧版]
        MDS[maket_data_service/<br/>市场数据-旧版]
    end

    subgraph 工具服务
        HELP[helpers.py<br/>通用工具函数]
        IC[industry_classification.py<br/>行业分类核心]
        MA[maket_alert.py<br/>市场异动检测]
        SI[stock_industry.py<br/>股票行业]
        SU[stock_utils.py<br/>股票工具]
    end
```

### 3.4 配置与基础设施

```mermaid
flowchart LR
    subgraph config_配置
        C[config.py<br/>Config 单例<br/>LLM / Service / Search 密钥]
        C -->|启动时校验| VALIDATE[validate()]
    end

    subgraph core_核心模块
        LOG[logging.py<br/>结构化 JSON 日志<br/>requestId]
        MET[metrics.py<br/>Prometheus 指标]
        VLD[validation.py<br/>@validate_body / @validate_query]
        VER[version_shim.py<br/>@deprecated_route 装饰器]
        CACHE_H[cache_headers.py<br/>缓存头控制]
        CORS_C[cors_config.py<br/>CORS 配置]
    end

    subgraph schemas_校验模型
        AS[analysis_schemas.py<br/>Rating / DashboardEval / AnalystReport]
        ALS[alert_schemas.py<br/>告警规则校验]
        BTS2[backtest_schemas.py<br/>回测参数]
        API_DOC[apidoc.py<br/>Swagger 模型]
    end
```

---

## 4. AI 架构

### 4.1 多分析师并行流水线

```mermaid
flowchart TD
    REQ[前端请求分析] --> AIS[AIService.analyze_fund]
    AIS --> RESOLVE[AnalysisMemoryLog.resolve_pending<br/>结算旧预测并生成反思]
    AIS --> CONTEXT[AnalysisMemoryLog.get_past_context<br/>检索历史分析记录]
    AIS --> NEWS[_fetch_news_context<br/>注入实时新闻 → 防幻觉]
    AIS --> SECTOR[_fetch_sector_context<br/>注入热门板块数据]

    AIS --> ORCH[AnalystOrchestrator.analyze]

    subgraph ORCH_并行分析
        ORCH --> TPE[ThreadPoolExecutor<br/>max_workers=4]
        TPE --> PA[PerformanceAnalyst<br/>业绩分析师]
        TPE --> HA[HoldingAnalyst<br/>持仓分析师]
        TPE --> MA[ManagerAnalyst<br/>经理分析师]
        TPE --> MCA[MarketContextAnalyst<br/>市场环境分析师]

        PA -->|AnalystReport| SYNTH
        HA -->|AnalystReport| SYNTH
        MA -->|AnalystReport| SYNTH
        MCA -->|AnalystReport| SYNTH
    end

    SYNTH[Supervisor.synthesize<br/>合成报告] --> LLM_CALL[LLM 调用<br/>OpenAI 兼容接口]
    LLM_CALL --> PARSE[_parse<br/>Pydantic 校验]
    PARSE --> RESULT[FundAnalysisResult<br/>五档评级 + 评分]

    AIS --> STORE[AnalysisMemoryLog.store_analysis<br/>持久化分析结果]
    RESULT -->|SSE 流式响应| REQ
```

### 4.2 分析师类层次

```mermaid
flowchart TD
    BA[BaseAnalyst<br/>基类] -->|_call_llm| LLM[LLM API 调用]
    BA -->|_extract_json| JSON[JSON 多策略提取]
    BA -->|_format_fund_basic| FMT[数据格式化]

    BA --> PA[PerformanceAnalyst<br/>收益率 / Sharpe / 回撤]
    BA --> HA[HoldingAnalyst<br/>持仓集中度 / 股票质量]
    BA --> MA2[ManagerAnalyst<br/>经理经验 / 风格稳定性]
    BA --> MCA[MarketContextAnalyst<br/>市场情绪 / 政策 / 宏观]
    BA --> BA2[BullAnalyst<br/>乐观视角]
    BA --> BA3[BearAnalyst<br/>悲观视角]

    BA --> SUP[Supervisor<br/>合成领导者]
    SUP --> SYNTH2[synthesize<br/>汇总 4 份报告 → LLM]
    SYNTH2 --> PARSE2[Pydantic 校验]
    PARSE2 --> RATING{Rating 枚举}
    RATING -->|Strong Buy| SB
    RATING -->|Buy| B
    RATING -->|Hold| H
    RATING -->|Underweight| UW
    RATING -->|Sell| S
```

### 4.3 分析记忆反射闭环

```mermaid
sequenceDiagram
    participant AIS as AIService
    participant ML as MemoryLog
    participant DB as SQLite
    participant LLM as LLM

    Note over AIS,LLM: 分析时
    AIS->>ML: resolve_pending()
    ML->>DB: 查询超过 7 天的未结算记录
    DB-->>ML: 返回待结算记录
    ML->>DB: 获取当前 1 个月收益率
    DB-->>ML: 收益率数据
    ML->>LLM: _generate_reflection()<br/>对比预测 vs 实际
    LLM-->>ML: 反思文本
    ML->>DB: 更新 reflection + status=resolved

    AIS->>ML: get_past_context()
    ML->>DB: 查询最近 N 条已结算记录
    DB-->>ML: 历史反思
    ML-->>AIS: 历史上下文 → 注入本次分析 prompt

    Note over AIS,LLM: 分析后
    AIS->>ML: store_analysis()
    ML->>DB: INSERT analysis_memory
```

### 4.4 AI 聊天 Agent

```mermaid
flowchart LR
    subgraph Chat_Agent
        CHAT[chat.py<br/>对话逻辑]
        TH[tool_handlers.py<br/>工具调用]
    end

    USER[用户] -->|消息| CHAT
    CHAT -->|意图识别| TH
    TH -->|基金查询| fundAPI
    TH -->|市场数据| marketAPI
    TH -->|AI 分析| AIService
    CHAT -->|回复| USER

    CHAT -->|会话持久化| DB[chat_session / chat_message]
```

---

## 5. 数据流

### 5.1 基金详情请求全链路

```mermaid
sequenceDiagram
    participant U as 用户浏览器
    participant FE as 前端 Vue
    participant BE as 后端 Flask
    participant DS as Service Express
    participant PC as ProviderChain
    participant EXT as 外部数据源

    U->>FE: 打开基金详情页
    FE->>FE: FundDetailView mount
    FE->>BE: GET /api/fund/{code}?source=auto
    BE->>BE: get_fund_detail()

    alt source = auto / data_service
        BE->>BE: _try_data_service_fund_detail()
        BE->>DS: GET /api/funds/{code}/detail
        DS->>DS: fundService.getFundDetail()

        par 并行获取 16 个数据段
            DS->>PC: 实时估值
            PC->>EXT: stock-sdk → fail
            PC->>EXT: eastmoney → success
            EXT-->>PC: 估值数据
            PC-->>DS: 结果

            DS->>PC: 净值历史
            PC->>EXT: stock-sdk → success
            EXT-->>PC: 历史数据
            PC-->>DS: 结果

            DS->>PC: 持仓明细
            DS->>PC: 资产配置
            DS->>PC: 经理信息
            Note over DS,PC: ... 其余 12 段类似
        end

        DS-->>BE: 统一响应体（含所有段）
        BE->>BE: data_service_legacy_mapper.py<br/>映射为旧格式

        BE->>BE: _validate_data_service_fund_quality()
        Note over BE: 6 项质量检查<br/>1. fund_code<br/>2. fund_name<br/>3. estimate 不缺失<br/>4. net_worth_trend 有数据<br/>5. portfolio 有股票<br/>6. risk_metrics 有值

        alt 质量通过
            BE-->>FE: 返回 Service 数据
        else 质量未通过 && source=auto
            BE->>BE: 回退 legacy FundAPI
            BE-->>FE: 返回 legacy 数据
        end
    else source = legacy
        BE->>BE: FundAPI 直接调用
        BE-->>FE: 返回 legacy 数据
    end

    FE->>FE: 渲染基金详情页
```

### 5.2 ProviderChain 模式

```mermaid
flowchart TD
    subgraph ProviderChain_迭代器模式
        PC[ProviderChain&lt;P&gt;] --> ITER[run(operation, invoke)]
        ITER --> FOR[for each provider]
        FOR --> TRY{invoke 成功?}
        TRY -->|是| RET[返回结果<br/>result.fallback = false]
        TRY -->|否| LOG[记录错误<br/>继续下一个]
        LOG --> FOR
        FOR -->|全部失败| THROW[抛出 AppError]
    end

    subgraph Providers_提供者
        SS[StockSdkFundProvider<br/>stock-sdk]
        EM[EastMoneyFundProvider<br/>eastmoney]
        EM2[EastMoneyMarketProvider<br/>eastmoney]
        TC[TencentStockProvider<br/>tencent]
    end

    subgraph Service_消费者
        FS[fundService.ts]
        MS[maketService.ts]
    end

    FS --> PC
    MS --> PC
    PC --> SS
    PC --> EM
    PC --> TC
```

### 5.3 缓存策略

```mermaid
flowchart LR
    subgraph Cache_TTLs
        EST[实时估值<br/>30s]
        MQ[行情报价<br/>15s]
        HIST[净值历史<br/>24h]
        DIV[分红数据<br/>7d]
    end

    subgraph Cache_机制
        CT[cacheThrough<br/>缓存穿透保护]
        MEM[(内存 Map<br/>concurrent)]
    end

    REQ[请求] --> CT
    CT --> MEM
    MEM -->|命中| HIT[返回缓存]
    MEM -->|未命中| FETCH[调用 ProviderChain]
    FETCH --> STORE[写入缓存]
    STORE --> RESP[返回响应]
```

---

## 6. 数据库 ER 图

```mermaid
erDiagram
    fund_basic_info ||--o{ fund_estimate : has
    fund_basic_info ||--o{ fund_trend : has
    fund_basic_info ||--o{ fund_portfolio : has
    fund_basic_info ||--o{ fund_risk_metrics : has
    fund_basic_info ||--o{ fund_screening_rank : ranks
    fund_basic_info ||--o{ fund_industry_tag : tags
    fund_basic_info ||--o{ analysis_memory : analyzed

    fund_watchlist_group ||--o{ fund_watchlist : contains
    fund_watchlist ||--o| fund_basic_info : references

    chat_session ||--o{ chat_message : contains

    alert_rule ||--o| fund_basic_info : monitors

    fund_basic_info {
        string code PK "基金代码"
        string name "基金名称"
        string fund_type "基金类型"
        string fund_name_full "全称"
        float one_year_return "一年收益率"
        float total_return "累计收益率"
        float total_asset "资产规模"
        string fund_name_initial "拼音首字母"
        text performance "业绩 JSON"
    }

    fund_estimate {
        string code PK,FK "基金代码"
        float estimate_value "实时估值"
        float estimate_change_pct "估值涨跌幅"
        float nav "最新净值"
        datetime estimate_time "估值时间"
    }

    fund_trend {
        string code PK,FK "基金代码"
        text net_worth_trend "净值走势 JSON"
        text ranking_trend "排名走势 JSON"
        text total_return_trend "累计收益走势 JSON"
    }

    fund_portfolio {
        string code PK,FK "基金代码"
        text stocks "持仓股票 JSON"
        text sectors "行业分布 JSON"
    }

    fund_risk_metrics {
        string code PK,FK "基金代码"
        float sharpe_ratio "夏普比率"
        float max_drawdown "最大回撤"
        float volatility "波动率"
        float alpha "Alpha"
        float beta "Beta"
    }

    fund_industry_tag {
        string code PK,FK "基金代码"
        string industry_name "行业名称"
        float exposure_ratio "暴露比例"
    }

    fund_screening_rank {
        string code PK,FK "基金代码"
        string same_type_rank "同类排名"
        int flag_4433 "4433 选基标志"
    }

    analysis_memory {
        int id PK "主键"
        string fund_code FK "基金代码"
        string rating "评级"
        float sentiment_score "情绪评分"
        text thesis "分析摘要"
        text reflection "LLM 反思"
        string status "pending / resolved"
        datetime created_at "创建时间"
    }

    fund_watchlist_group {
        int id PK "主键"
        string name "分组名称"
        int sort_order "排序"
    }

    fund_watchlist {
        int id PK "主键"
        int group_id FK "分组 ID"
        string fund_code FK "基金代码"
        int sort_order "排序"
    }

    alert_rule {
        int id PK "主键"
        string fund_code FK "基金代码"
        string condition "条件类型"
        float threshold "阈值"
        string direction "上涨/下跌"
        bool enabled "启用状态"
    }

    chat_session {
        string id PK "会话 ID"
        string title "会话标题"
        datetime created_at "创建时间"
    }

    chat_message {
        int id PK "主键"
        string session_id FK "会话 ID"
        string role "user / assistant"
        text content "消息内容"
        datetime created_at "发送时间"
    }

    fund_extra_data {
        string code PK,FK "基金代码"
        text holder_structure "持有人结构 JSON"
        text asset_allocation "资产配置 JSON"
        text managers "经理信息 JSON"
        text subscription_redemption "申赎状态 JSON"
    }

    daily_market_summary {
        date trade_date PK "交易日期"
        text summary "LLM 市场总结"
        datetime generated_at "生成时间"
    }
```

---

## 附录：关键文件一览

| 文件路径 | 行数 | 作用 |
|----------|------|------|
| `Scripts/app.py` | 278 | Flask 应用入口，Blueprint 注册，中间件 |
| `Scripts/ai_service.py` | 550 | AI 分析编排器 |
| `Scripts/services/data_service_client.py` | 277 | Service HTTP 客户端 |
| `Scripts/services/memory_log.py` | 183 | 分析记忆日志与 LLM 反射 |
| `Scripts/services/fund_analysts/orchestrator.py` | 99 | 多分析师并行编排 |
| `Scripts/services/fund_analysts/supervisor.py` | 105 | 合成报告 Supervisor |
| `Scripts/models.py` | 530+ | SQLAlchemy 数据模型 |
| `Service/src/app.ts` | 77 | Express 应用配置 |
| `Service/src/services/fundService.ts` | 545 | 基金数据服务（ProviderChain 调度） |
| `Service/src/core/providerChain.ts` | 64 | ProviderChain 迭代理器 |
| `Frontend/src/App.vue` | 111 | 应用壳布局 |
| `Frontend/src/router/index.ts` | 86 | 7 条路由配置 |
| `Frontend/src/services/api.ts` | 134 | Axios API 客户端 |
