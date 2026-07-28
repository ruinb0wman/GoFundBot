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
     → navHistory() pingzhongdata JS → 用昨日涨跌幅估算
```

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
  1. eastmoney push2 API (100.NDX 等 secid)
  2. 失败 → yahoo finance API
```

## 前端网络回退

```typescript
// api.ts:23
async function getWithLocalFallback<T>(path: string) {
  try {
    return await api.get(path);          // 通过 Vite proxy → localhost:3100
  } catch (error) {
    if (error?.message === 'Network Error') {
      return localBackendApi.get(path);  // 直连 localhost:3100（绕过 proxy）
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

分值持久化：前端 localStorage → `PUT /api/datasource-scores` → Express 内存。

## 缓存回退 (TTL 体系)

| 数据类型 | TTL | 说明 |
|---------|-----|------|
| 基金估值 | 30s | 盘中频繁更新 |
| 行情报价 | 15s | 实时性要求高 |
| 涨停股/涨跌家数 | 30s | 盘中变动 |
| 北向资金 | 15s | 盘中变动 |
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
