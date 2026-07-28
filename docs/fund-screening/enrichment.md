# 基金指标丰富化

## 一、概述

从东方财富拿到原始的收益排行数据后，后端对每只基金调用 `enrichFund(code)` 进行丰富，结果存入内存 `enrichmentMap`。

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

### 关键代码

`screeningEnrichment.ts`:

```typescript
export async function enrichFund(code: string): Promise<void> {
  const [navResult, typeList] = await Promise.all([
    getFundNavHistory(code, {}),
    fetchFundCodeSearchList(),
  ]);
  const navPoints = navResult.data?.items ?? [];
  const fundListItem = typeList.find(f => f.code === code);
  enrichmentMap.set(code, {
    fund_type: fundListItem?.type ?? null,
    industry_tag: classifyFundIndustry(fundListItem?.name ?? code),
    ...computeRiskMetrics(navPoints.map(p => ({ date: p.date, nav: p.nav }))),
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

## 五、enrichmentMap 内存管理

```typescript
export const enrichmentMap = new Map<string, FundEnrichment>();
```

- 存储位置：`Service/src/services/screeningEnrichment.ts`
- 生命周期：进程存活期间有效，服务重启后需重新丰富
- 同步策略：前端通过 `GET /api/screening/sync` 获取快照，数据量决定同步是否从头走 enrichment 还是直接返回已有数据
- 更新方式：`POST /api/screening/update` 触发后台批量更新（并发 10 条）
- 单条更新：`POST /api/screening/update-single/:code`

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
