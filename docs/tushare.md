# Tushare Pro — 定价与数据覆盖分析

## 定价方案

| 等级 | 积分 | 年费 | 频率限制 |
|------|------|------|---------|
| 免费 | 120 | **0 元** | 50次/分钟，8000次/天/API |
| **标准** | **2,000** | **200 元/年** | 200次/分钟，10万次/天/API |
| **进阶** | **5,000** | **500 元/年** | 500次/分钟，无上限 |
| 高级 | 10,000 | 1,000 元/年 | 500次/分钟 |
| 专业 | 15,000 | 1,500 元/年 | 500次/分钟，特色数据无限制 |

> 积分获取比例：1 元 = 10 积分。机构用户价格为个人 10 倍。

## 接口权限与所需积分

| 接口 | 功能 | 所需积分 |
|------|------|---------|
| `daily` / `weekly` / `monthly` | 股票 K 线 | 2,000 |
| `index_daily` | 指数日线 | 2,000 |
| `stock_basic` | 股票基础信息 | 2,000 |
| `moneyflow` | 个股资金流向 | **2,000** |
| `moneyflow_hsgt` | 沪深港通资金流向 | 2,000 |
| `limit_list` | 龙虎榜 | 2,000 |
| `fund_nav` | 基金净值 | 2,000 |
| `fund_basic` | 基金基本信息 | 2,000 |
| `fund_dividend` | 基金分红 | 2,000 |
| `fund_manager` | 基金经理 | 2,000 |
| `fund_share` | 基金规模变动 | 2,000 |
| `fund_sr` | 基金申赎费率 | 2,000 |
| `fund_holder` | 持有人结构 | 2,000 |
| `fund_asset` | 资产配置 | 2,000 |
| `ths_index` / `ths_member` | 行业分类/成份股 | 2,000 |
| `fund_portfolio` | **基金持仓（股票组合）** | **5,000** |

## Tushare 无法覆盖的功能

| 功能 | 原因 | 当前来源 |
|------|------|---------|
| 实时行情/盘口 | Tushare 仅 T+1 数据 | tencent / stock-sdk |
| 基金实时估值 | 无对应接口 | stock-sdk / eastmoney |
| 全球指数 | 仅 A 股 | eastmoney / yahoo |
| 黄金/白银价格 | 无贵金属数据 | jijinhao.com |
| 快讯新闻 | 需单独购买（1000元/年） | eastmoney / baidu / cls |
| 大盘资金流向汇总 | 需遍历个股自行聚合 | — |

## 结论：最低成本覆盖方案

- **200 元/年**（2,000 积分）：覆盖大部分功能（基金净值/信息/分红/K线/个股资金流/北向资金等），**不包括基金持仓**（`fund_portfolio` 需 5,000 积分）。
- **500 元/年**（5,000 积分）：全功能覆盖，包括基金持仓，更高的调用频率。
- Tushare 适合作为**历史/延迟数据的补充**，实时数据仍需保留现有免费来源。

## 当前项目状态

| 项目 | 状态 |
|------|------|
| pip 安装 | ✅ `python/.venv` 中已安装 |
| Token | ✅ 已注册获取 |
| `daily` API | ✅ 有权限 |
| `moneyflow` API | ❌ 需 2,000 积分（当前仅 100 分） |
| 其他接口 | ❌ 积分不足 |

## 接入方式

```python
import tushare as ts
pro = ts.pro_api(token)
df = pro.moneyflow(trade_date='20260722')
```

聚合全市场个股后得到大盘资金流：

```python
{
    "date": "2026-07-22",
    "mainNetInflow": ...,
    "superLargeNetInflow": ...,
    "largeNetInflow": ...,
    "mediumNetInflow": ...,
    "smallNetInflow": ...,
}
```

## 后端实现要点

- token 存入 Settings（`PUT /api/settings` → `{ search: { tushareToken: "xxx" } }`）
- 读 settings 传给 Python CLI 脚本
- 优先级链：EastMoney (push2) → Tushare (moneyflow) → 返回空
- 前端在分项数据不全时显示"获取失败"

## 相关文件

- `python/cli/data_complete.py` — `complete_market_money_flow()` 是接入点
- `service/src/services/marketService.ts` — `getMarketMoneyFlowFromAkshare()` 是后台回退函数
- `service/src/services/settingsService.ts` — Settings 模型，需加 `tushareToken` 字段
