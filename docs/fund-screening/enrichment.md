# 基金指标丰富化

## 一、概述

风险指标计算现在有**双路径**：

- **新路径（默认）**：前端通过 `POST /api/funds/nav-batch` 批量获取 NAV 历史，本地 `computeRiskMetricsLocal()` 计算风险指标（`frontend/src/utils/number.ts:188`）。结果持久化在 IndexedDB，每日首次加载时自动计算一次，全天使用缓存。
- **旧路径（遗留）**：服务端 `enrichFund()` → `enrichmentMap`，保留向后兼容。服务重启不丢失风险指标（旧路径丢失时新路径自动补齐）。

以下文档主要描述旧路径实现，新路径的本地计算逻辑与服务端 `computeRiskMetrics()` 等价。

## 二、enrichFund 流程

```typescript
enrichFund(code)
├─ getFundNavHistory(code) → NAV 历史 → computeRiskMetrics(navPoints)
│     ├─ max_drawdown_1y (近1年最大回撤)
│     ├─ max_drawdown_3m/6m/3y/all
│     ├─ sharpe_ratio_1y / sharpe_ratio_3y
│     ├─ volatility_1y / volatility_3y
│     ├─ annual_return_1y / annual_return_3y
│     └─ calmar_ratio_1y / calmar_ratio_3y
├─ fetchFundCodeSearchList() → 基金类型 (股票型/混合型/债券型/指数型/FOF/QDII/货币型)
└─ classifyFundIndustry(name) → 行业标签
```

### 关键代码（已前端化）

> 该模块整体迁移至前端：Node `/api/screening/sync` 返回**原始**清单，丰富化由前端完成。

```typescript
// frontend/src/composables/useScreeningDb.ts (syncFromServer)
// 1. GET /api/screening/sync → 原始 funds（fund_code / returns / nav ...）
// 2. 保留旧风险指标（若 sync 未返回）
// 3. 本地 computeRiskMetricsLocal(navs) + classifyFundIndustry(name)
// 4. compute4433() 排名 → bulkPut 写入 Dexie screeningFunds
```
    updated_at: new Date().toISOString(),
  });
}
```

## 三、风险指标计算

`riskMetricsService.ts:79` `computeRiskMetrics()`：

### 3.1 输入

```
NavPoint[]: [{ date: string, nav: number }]
```

### 3.2 计算步骤

```
1. 排序: 按 date 升序
2. 切片: sliceByDays(points, 365) → 近1年数据
3. 日收益率: dailyReturns(navs) → 相邻净值比值-1
4. 年化收益率: annualReturn(navs, tradingDays)
   → (navs[-1]/navs[0] - 1) 年化至 252 个交易日
5. 波动率: volatility(dailyReturns)
   → 日收益率标准差 × √252 → 年化百分比
6. 最大回撤: maxDrawdown(navs)
   → 遍历找 peak → (peak - nav)/peak 的最大值
7. 夏普比率: sharpeRatio(annualRet, vol)
   → (annualRet - 2%) / vol
8. 卡玛比率: calmarRatio(annualRet, maxDd)
   → annualRet / maxDd
```

### 3.3 最小数据要求

| 周期 | 最少交易日 | 参数 |
|------|----------|------|
| 1年 | 200 天 | `minTradingDays.1y = 200` |
| 3年 | 600 天 | `minTradingDays.3y = 600` |

不满足则返回 `null`。

### 3.4 异常过滤

- 单日收益率绝对值 ≥ 50% 时过滤（数据异常）
- 年化波动率 > 500% 时返回 `null`

### 3.5 输出

```typescript
interface RiskMetricsResult {
  max_drawdown_3m/6m/1y/3y/all: number | null;
  sharpe_ratio_1y/3y: number | null;
  volatility_1y/3y: number | null;
  annual_return_1y/3y: number | null;
  calmar_ratio_1y/3y: number | null;
}
```

## 四、行业分类

`industryService.ts:22` `classifyFundIndustry()`，基于基金名称关键词匹配：

| 正则 | 行业标签 |
|------|---------|
| `/创新药\|医疗\|医药\|生物\|医美\|健康/` | 医药医疗 |
| `/新能源\|光伏\|风电\|氢能\|锂电\|电池\|能源/` | 新能源 |
| `/半导体\|芯片\|集成电路\|电子/` | 半导体/芯片 |
| `/AI\|人工智能\|智能\|机器人\|大模型\|算力/` | 人工智能 |
| `/消费\|白酒\|食品\|饮料\|家电\|零售/` | 消费 |
| `/科技\|互联\|信息\|软件\|IT\|计算机/` | 科技 |
| `/金融\|银行\|保险\|证券\|地产/` | 金融地产 |
| `/军工\|国防\|航天\|航空/` | 军工 |
| `/化工\|材料\|有色\|钢铁\|建材/` | 周期 |
| `/沪深300\|中证\w+\|上证\w+\|MSCI\|指数/` | 宽基指数 |
| `/红利\|股息/` | 红利 |
| `/债券\|纯债\|短债\|信用债\|利率债/` | 固收 |
| `/货币\|理财/` | 货币 |
| `/海外\|QDII\|纳斯达克\|恒生\|标普\|港股\|美股/` | 海外 |
| `/新能源车\|汽车/` | 新能源汽车 |
| `/通信\|5G\|6G\|光模块/` | 通信 |
| `/碳中和\|环保\|ESG/` | 环保/碳中和 |
| `/黄金\|贵金属/` | 黄金/贵金属 |
| 未匹配 | 其他 |

规则优先级按数组顺序，首个匹配即返回。

## 五、丰富化数据落地（Dexie，替代 enrichmentMap）

```typescript
// 前端 Dexie screeningFunds 表保存丰富化结果（fund_code 主键）
// 风险指标：max_drawdown_1y / sharpe_ratio_1y / sharpe_ratio_3y / volatility_1y / calmar_ratio_1y
// 行业标签：industry_tag_name（classifyFundIndustry 正则 + 前端兜底）
```

- 存储位置：`frontend/src/db/index.ts` → `screeningFunds`
- 生命周期：IndexedDB 持久化，浏览器刷新不丢；`lastSyncTime`（localStorage）控制刷新节奏
- 同步策略：前端通过 `GET /api/screening/sync` 获取原始快照，本地计算丰富化后入库
- 更新方式：`POST /api/screening/update` 刷新 Node 快照缓存；GUI 更新后前端 `syncFromServer(force)` 重算

## 六、同类排名百分位

排名在客户端 `useScreeningDb.ts:111` `compute4433()` 中计算：

```
1. 按 fund_type 分组
2. 每组内按各区间收益率排序
3. 排名百分位 = (当前排名 / 总数) × 100
   → 值越小表示排名越靠前（0 = 第1名）
4. 写入 IndexedDB rank_pct_* 字段
```

仅在 `syncFromServer()` 完成后自动触发，或在查询时由 `computed` 标记触发。
