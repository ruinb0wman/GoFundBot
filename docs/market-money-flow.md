# 今日资金流向 (Market Money Flow)

## 一、概述

展示沪深两市合计的资金流向，按单笔订单金额将投资者分为四档，反映不同类型投资者的买卖方向。

## 二、数据流路径

```
GET /api/market/money-flow
  → market.routes.ts → getMarketMoneyFlow()
    → ProviderChain([eastMoneyMarketProvider])
      → eastmoney push2his API (主)
        → 成功 → 返回 + 缓存 30s
        → 失败/空数据 → Akshare Python 回退
    → 前端 useMarketOverview → ECharts 横向柱状图
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/market.routes.ts:127` | `GET /api/market/money-flow` |
| service | `service/src/services/marketService.ts:522` | `getMarketMoneyFlow()` 编排 |
| Provider | `service/src/providers/eastmoney/eastmoneyMarketProvider.ts:350` | `marketMoneyFlow()` 东方财富实现 |
| Python 回退 | `python/cli/data_complete.py:315` | `complete_market_money_flow()` akshare 实现 |
| frontend API | `frontend/src/services/api.ts:99` | `getMarketMoneyFlow()` |
| frontend 渲染 | `frontend/src/composables/useMarketOverview.ts:302` | `moneyFlowOption` ECharts option |
| 缓存 | `service/src/core/cache.ts:172` | TTL 30s |

## 三、东方财富 API 数据源

### 3.1 端点

```
GET https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get
```

### 3.2 请求参数

| 参数 | 值 | 说明 |
|------|----|------|
| `fields1` | `f1,f2,f3,f7` | 基础字段 |
| `fields2` | `f51,f52,f53,f54,f55,f56,f57` | 资金流向字段 |
| `lmt` | `1` | 最近 1 天 |
| `klt` | `101` | 日线 |
| `secid` | `1.000001` | 上证指数 |
| `secid2` | `0.399001` | 深证成指 |
| `ut` | `b2884a393a59ad64002292a3e90d46a5` | 固定 token |

### 3.3 字段映射与分类标准

返回格式为 CSV 字符串数组 (klines)，每行按逗号分割。

合并表（API 字段 → DTO → 前端标签 → 订单分类 → 投资者类型）：

| Index | API 字段 | DTO 字段 | 前端标签 | 订单分类 | 单笔金额区间 | 投资者类型 |
|-------|---------|---------|---------|---------|-------------|-----------|
| parts[0] | f51 | `date` | — | — | — | — |
| parts[1] | f52 | `mainNetInflow` | — | **主力净流入(合计)** | = 超大单+大单 | — |
| parts[2] | f53 | `smallNetInflow` | 散户 | 小单 | < 4 万元 | 散户 |
| parts[3] | f54 | `mediumNetInflow` | 中户 | 中单 | 4 万 ~ 100 万 | 中户 |
| parts[4] | f55 | `largeNetInflow` | 大户 | 大单 | 100 万 ~ 500 万 | 大户/游资 |
| parts[5] | f56 | `superLargeNetInflow` | 机构 | 超大单 | ≥ 500 万元 | 机构 |
| parts[6] | f57 | — | — | 主力净流入占比 | — | — |

> **符号约定**：正值为净流入（买入 > 卖出），负值为净流出（卖出 > 买入）。
> 四类独立订单（小单/中单/大单/超大单）净流入之和 ≈ 0（买入 = 卖出）。

### 3.4 重要：主力净流入的构成关系

**`mainNetInflow` (f52) = `superLargeNetInflow` (f56) + `largeNetInflow` (f55)**

`mainNetInflow` 不是独立订单分类，而是超大单 + 大单的合计值（合计结果可视为"机构+大户"的总方向）。

**历史 Bug（已修复）**：

修复前展示 `[主力, 机构, 大户, 散户]`，分别映射 `[mainNetInflow, superLargeNetInflow, largeNetInflow, smallNetInflow]`：
- `mainNetInflow` = `superLargeNetInflow` + `largeNetInflow`，买入侧被重复计算翻倍
- 遗漏了中单 (`mediumNetInflow`)，流出侧不完整

修复后展示 `[机构, 大户, 中户, 散户]`，分别映射 `[superLargeNetInflow, largeNetInflow, mediumNetInflow, smallNetInflow]`：
- 4 根柱子对应 4 个独立订单分类，互不重叠，总和 ≈ 0
- 标签与订单分类、投资者类型完全对齐

## 四、回退方案：Akshare

当东方财富 API 不可用时，自动降级到 `data_complete.py` 脚本：

```
Node.js → child_process.spawn → data_complete.py --source akshare --type money_flow
  → akshare.stock_market_fund_flow()
  → stdout JSON → Node.js 解析
```

返回格式与东方财富一致（`MarketMoneyFlowDto`）。

## 五、前端渲染

| 项 | 说明 |
|----|------|
| 组件 | `frontend/src/components/MarketOverview.vue` — "市场资金流向" section |
| Composable | `frontend/src/composables/useMarketOverview.ts:302` — `moneyFlowOption` |
| 图表类型 | ECharts 横向柱状图（`type: 'bar'`），4 条互斥柱 |
| 数值单位 | 元 → 亿（代码中 `/ 1e8` 转换） |
| 颜色规则 | 正值（净流入）红色（`--color-danger`），负值（净流出）绿色（`--color-success`） |
| 轮询间隔 | 每 600s 刷新一次（`moneyFlowPoller`） |

## 六、已知问题

1. **EastMoney push2his 接口反爬**：`push2.eastmoney.com` SSL EOF 问题，若 `marketMoneyFlow()` 返回空数据则自动走 Akshare 回退。
2. **数据延迟**：东方财富的资金流数据通常在收盘后 30 分钟左右才完整，盘中数据可能不完整或为 0。
3. **Tushare 替代方案**：`moneyflow` 接口需 2,000 积分（当前积分不足），详见 `docs/tushare.md`。
