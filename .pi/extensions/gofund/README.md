# GoFundBot tools for pi

Terminal `pi`（在本仓库目录启动）通过这些工具读写 GoFundBot。

**这里没有具体工具定义。** 工具清单由 `service` 提供：扩展启动时拉
`GET /api/agent/tools`（名称 / 描述 / JSON Schema / readOnly），逐个注册成 pi 工具，
调用时走 `POST /api/agent/call`。口径、数据映射、踩坑注释的唯一真源在
`service/src/agent/tools*.ts`（以及它们调用的 `services/*`）。

```bash
# 终端 A —— service
cd service && bun run dev

# 终端 B —— 仓库根目录
pi
# 直接问：「今天大盘怎么样，前 5 个热门板块是什么」
```

首次在本目录运行 pi 会问 **project trust**（项目扩展只在信任后加载）。

## 工具（23 个，由 service 提供）

| 组 | 工具 |
|---|---|
| 市场 | `get_market_indices` `get_index_kline` `get_hot_sectors` `get_concept_sectors` `get_north_flow` `get_market_breadth` `get_main_flow` `get_gold_realtime` |
| 基金 | `search_funds` `get_fund_detail` `get_fund_estimate` `get_fund_nav_history` `get_fund_holdings` `get_fund_managers` `get_flash_news` |
| 计算 | `run_backtest` `run_portfolio_backtest` `compare_backtest_strategies` `screen_funds` `get_screening_status` |
| 用户数据 | `list_strategies` `save_strategy`（写） `get_positions` |

改工具请改 `service/src/agent/`，然后跑 `bun run gen:tools` 更新静态清单。
用 `curl -s localhost:8310/api/agent/tools | jq '.data.tools[].name'` 可直接看到清单。

## 写操作需要确认

`save_strategy` 是写操作（`readOnly: false`）：

1. 第一次调用只返回 `confirm_required` + `__confirm_token`，**不落库**；
2. 把这行 pi 工具结果里的提示转成对用户的说明（展示要写入的完整内容），拿到明确同意后，
   带着**完全相同的参数** + `__confirm_token` 再调一次，才真正写入。

令牌一次性、10 分钟过期、绑定（工具名 + 参数指纹）—— 参数被改过会拒绝并重新要确认。
实现见 `service/src/agent/confirm.ts`。

## 降级（service 没起来）

| 情况 | 行为 |
|---|---|
| service 在线 | 用它的清单（最新） |
| service 离线 | 用 `tools.manifest.ts`（`bun run gen:tools` 生成，随仓库提交）—— 工具仍在，调用返回明确的「service 未启动」提示 |
| 清单也没有 | 只注册一个泛化的 `gofund_call(tool, args)` |

不写「静态清单」就退化成「pi 里一个 GoFundBot 工具都没有」，模型连工具名都看不到 —— 所以清单要跟着工具一起提交。

## 配置

| Env var | Default | 用途 |
|---|---|---|
| `GOFUND_API_BASE` | `http://localhost:8310` | service 地址（service 跑在别处时覆盖） |

## 相关

- 技能：`.pi/skills/gofund-data/SKILL.md`（何时用、口径陷阱、组合套路）
- 策略页面控制：`.pi/extensions/gofund-app/`（只剩 `gofund_strategy_open`）
- 服务端契约：`service/src/agent/`、`service/src/routes/agent.routes.ts`
