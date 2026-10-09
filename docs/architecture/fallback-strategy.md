# 数据回退策略

## ProviderChain 自动降级（核心）

```
for (const [index, provider] of orderedProviders.entries()) {
  try {
    const data = await invoke(provider);
    if (validate && !validate(data)) {
      throw new Error(`Validation failed for ${provider.name}`);
    }
    scorer?.recordSuccess(provider.name, operation);
    return { data, provider: provider.name, fallback: index > 0, ... };
  } catch (error) {
    scorer?.recordFailure(provider.name, operation);
    providerErrors.push({ provider, message, code });
  }
}
throw new AppError('PROVIDER_UNAVAILABLE', 'All providers failed', 503, { providerErrors });
```

| 业务域 | 主 Provider | 备 Provider | 数据有效性校验 |
|--------|-----------|-------------|---------------|
| 基金估值 | stock-sdk | eastmoney | `nav != null \|\| estimatedNav != null` |
| 基金 NAV 历史 | stock-sdk | eastmoney | — |
| 基金排名历史 | stock-sdk | eastmoney | — |
| 基金分红 | stock-sdk | eastmoney | — |
| 行情报价 | stock-sdk | eastmoney | — |
| A 股 K 线 | stock-sdk | eastmoney | — |
| 主要指数 | tencent → stock-sdk | eastmoney | — |
| 股票信息 | eastmoney | tencent | — |
| 新闻快讯 | eastmoney | baidu → cls | — |
| 网络搜索 | Bocha | Tavily → DuckDuckGo | — |

## EastMoney 内部回退策略

EastMoney 部分接口（如实时估值批量 API）存在反爬限制，provider 内部实现了第二级回退：

```
EastMoneyFundProvider.estimate(code):
  1. fetchFundGuZhiBatch() — 批量实时估值 API（缓存 30s）
     → 成功 → 从 batch 中查找该基金
  2.  batch 失败或未找到 → estimateFromPingZhongData()
     → 直接读一次 pingzhongdata JS（不经过 navHistory，避免二次取脚本）
     → 普通基金：用 `Data_netWorthTrend` 最后两点的涨跌幅估算
     → 货币基金：`nav = 1` + 7 日年化 / 每万份收益（货币基金没有盘中估值）
```

### 货币基金（`ishb = true`）没有净值走势

东财 pingzhongdata 对货币基金**不输出 `Data_netWorthTrend` / `Data_ACWorthTrend`**，只有
`Data_millionCopiesIncome`（每万份收益）、`Data_sevenDaysYearIncome`（7 日年化）、
`Data_grandTotal`（累计收益率 %）。而业绩走势 / 回撤 / 风险指标 / 回测 / 筛选富化全走净值序列，
所以 `EastMoneyFundProvider.navHistory()` 在净值走势缺失时会用**每万份收益复利累乘**合成一条
**累计收益指数**（起点 ≈ 1，`nav_i = ∏(1 + 收益_i/10000)`）：

- 与官方 `Data_grandTotal` 一致（000682：实算 37.26% vs 官方 37.24%；近 1 年 1.465% vs 排行 1.46%）。
- 货币基金真实单位净值恒为 **1**：前端映射层（`isMoneyFund` 分支）把 `dwjz` 覆写成 1、
  `prevDwjz = 1 - 每万份收益/10000`，展示改成「7 日年化 / 每万份收益」，**不能**把这条指数当净值用。
- 最大回撤恒为 0（序列单调上行）；年化波动 ~0.01%，此时夏普是「除以 ~0」的假象，
  `calcSharpe` 对年化波动 < 0.1% 的品种直接返回 null。

## Python 外部回退

当 EastMoney push2 API 被反爬封锁时（SSL EOF），自动降级到 Python 脚本：

```
MarketMoneyFlow:
  1. eastmoney push2his API (主)
  2. 返回空数据 / 异常 → data_complete.py --source akshare --type money_flow
     → akshare.stock_market_fund_flow()
     → stdout JSON → 解析为 MarketMoneyFlowDto
  3. 全部失败 → 返回空数据，前端显示"暂无数据"

GlobalIndexKline:
  1. tencent newfqkline（`param=usDJI|hkHSI,...`，国内直连，覆盖美股/港股指数）
  2. 失败/未收录 → yahoo finance API（3.5s 预算）

Crypto（行情 + K 线）:
  1. binance `api.binance.com`（直连 0.75s）
  2. 直连失败 → 同端点走一次代理 → 再失败 503
  （原 Yahoo 路径已删除：本机直连与代理均不通，4 个代码 2 批 × 15s = 30s）

NorthFlow（北向资金）:
  1. eastmoney datacenter RPT_MUTUAL_DEAL_HISTORY (主，取 DEAL_AMT，单位百万元)
  2. 失败 → data_complete.py --source akshare --type north_flow
     → 同一 datacenter 端点（不同 client）→ stdout JSON → NorthFlowDto
  3. 全部失败 → 503，前端 get_north_flow 返回 data_status="error"
  （净流入自 2024-08-19 起停止披露，三个 *NetInflow 恒为 null）
```

## 前端网络回退

```typescript
// api.ts:23
async function getWithLocalFallback<T>(path: string) {
  try {
    return await api.get(path);          // 通过 Vite proxy → localhost:8310
  } catch (error) {
    if (error?.message === 'Network Error') {
      return localBackendApi.get(path);  // 直连 localhost:8310（绕过 proxy）
    }
    throw error;
  }
}
```

## DataSourceScorer 自适应排序

`ProviderChain` 可接受 `DataSourceScorer` 实例，根据历史成功率动态排序 Provider：

| 参数 | 值 | 说明 |
|------|----|------|
| `initialScore` | 50 | 初始分 |
| `successIncrement` | +10 | 每次成功增加 |
| `failureDecrement` | -15 | 每次失败减少 |
| `consecutivePenalty` | -5/次 | 连续失败额外惩罚 |
| `decayPerHour` | ±2/小时 | 时间衰减，回归初始分 50 |

分值持久化：**前端 localStorage**（`useDataSourceScores`，原 `PUT /api/datasource-scores` 已撤销，不再同步 Express）。

## 缓存回退 (TTL 体系)

| 数据类型 | TTL | 说明 |
|---------|-----|------|
| 基金估值 | 30s | 盘中频繁更新 |
| 行情报价 | 15s | 实时性要求高 |
| 涨停股/涨跌家数 | 15s | 盘中变动 |
| 北向资金成交总额 | 5min | 盘后更新（净流入自 2024-08-19 起停止披露） |
| 大盘资金流向 | 30s | 盘中变动 |
| 黄金行情 | 60s | 贵金属 |
| A 股 K 线 | 1h | 日线不变 |
| 全球 K 线 | 1h | 跨时区 |
| 黄金历史 | 1h | 非实时 |
| 基金 NAV 历史 | 24h | 日级更新 |
| 基金排名历史 | 24h | 日级更新 |
| 基金基础数据 | 24h | 低频变动 |
| 基金搜索索引 | 24h | 低频变动 |
| 基金分红 | 7d | 低频变动 |
| 股票引用 | 7d | 低频变动 |
| 筛选快照 | 次日 9AM | 自适应过期时间 |
