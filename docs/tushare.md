# Tushare Pro — 资金流向数据

## 状态

| 项目 | 状态 |
|------|------|
| pip 安装 | ✅ `Scripts/.venv` 中已安装 |
| Token | ✅ 已注册获取 |
| `daily` API（基础行情） | ✅ 有权限 |
| `moneyflow` API（资金流） | ❌ 需要 **2000 积分**（免费用户 100 分） |

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
    "mainNetInflow": ...,          # 主力净流入
    "superLargeNetInflow": ...,    # 超大单净流入
    "largeNetInflow": ...,         # 大单净流入
    "mediumNetInflow": ...,        # 中单净流入
    "smallNetInflow": ...,         # 小单净流入
}
```

## 权限开通

前往 [tushare.pro](https://tushare.pro) → 个人中心 → 接口权限 → 申请 `moneyflow`。

要求：**2000 积分**（可通过实名认证 + 邀请等方式提升，或直接付费购买流量包）。

## 后端实现要点

- token 存入 Settings（`PUT /api/settings` → `{ search: { tushareToken: "xxx" } }`）
- 读 settings 传给 Python CLI 脚本
- 优先级链：EastMoney (push2) → Tushare (moneyflow) → 返回空
- 前端在分项数据不全时显示"获取失败"

## 相关文件

- `Scripts/cli/data_complete.py` — `complete_market_money_flow()` 是接入点
- `Service/src/services/marketService.ts` — `getMarketMoneyFlowFromAkshare()` 是后台回退函数
- `Service/src/services/settingsService.ts` — Settings 模型，需加 `tushareToken` 字段
