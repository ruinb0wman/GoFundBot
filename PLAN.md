# 数据源稳定性提升计划

## 阶段结构

每个阶段独立可恢复：若中断，从该阶段起始检查点重新执行即可。

---

## 阶段 0：ProviderChain 超时支撑

**目标**：给 `ProviderChain.run()` 增加 per-provider timeout，防止一个 provider 卡死拖垮整条链。

**改动文件**：
- `Service/src/core/providerChain.ts` — `run()` 接受 `{ timeoutMs? }` 选项，用 `AbortController` + `Promise.race` 实现

**Stage Check 0.1** (修改 chain 后)：
```bash
cd Service && npm run typecheck && npm run lint
```

**改动文件**：
- `Service/src/services/marketService.ts` — `stockSdkMarketProvider` 设 timeout 5s
- `Service/src/services/fundService.ts` — `stockSdkFundProvider` 设 timeout 8s

**Stage Check 0.2** (配置 timeout 后)：
```bash
cd Service && npm run typecheck && npm run lint && npm test
```

**Stage Check 0.3 (恢复点)**：
```bash
git diff --stat  # 确认只改了 3 个文件
```

---

## 阶段 1：腾讯行情 Provider + 链顺序调整

**目标**：新增 `TencentMarketProvider`，作为行情报价的第一顺位。

**改动文件**：
- `Service/src/providers/tencent/tencentMarketProvider.ts` — **新建**，实现 `MarketProvider` 接口
  - `quotes()`: 调 `qt.gtimg.cn?q=sh/sz+code`，复用现有解析逻辑
  - `kline()`: 调 `web.ifzq.gtimg.cn`（腾讯基金日K接口）
- `Service/src/providers/tencent/` — 可将 `toQtCode()`/`parseQtText()` 提取为共享 util（或保持内联）

**Stage Check 1.1** (provider 新建后)：
```bash
cd Service && npm run typecheck && npm run lint
```

**改动文件**：
- `Service/src/services/marketService.ts`
  - `getMarketQuotes` chain: `[tencentMarketProvider, stockSdkMarketProvider, eastMoneyMarketProvider]`
  - `getMarketKline` chain: `[tencentMarketProvider, stockSdkMarketProvider, eastMoneyMarketProvider]` + akshare fallback

**Stage Check 1.2 (恢复点 — market 端验收)**：
```bash
cd Service && npm run typecheck && npm run lint && npm test
# 手动验证（建议启动 dev 后用 curl 测）:
# curl http://localhost:3100/api/market/quotes?symbols=000001,600519
# 应返回 provider: "tencent"，速度 < 500ms
```

---

## 阶段 2：Python 脚本文件缓存

**目标**：`data_complete.py` 的 akshare 调用加文件缓存，避免每次实时请求。

**改动文件**：
- `Scripts/cli/shared/file_cache.py` — **新建**，装饰器函数 `file_cache(key, ttl_hours)`
  - 缓存目录: `Scripts/Data/cache/`
  - 检查缓存 JSON 文件 mtime + TTL，命中直接返回，未命中执行函数后写回

- `Scripts/cli/data_complete.py`
  - `complete_stock_list()` 和 `complete_industry_mapping()` 加 `@file_cache(key, ttl=24)` 装饰

**Stage Check 2.1** (缓存层验证)：
```bash
cd Scripts && .venv/bin/python -c "
from cli.shared.file_cache import file_cache
@file_cache('test', ttl_hours=0)
def test(): return {'hello': 'world'}
print(test())
assert test() == {'hello': 'world'}
"
```

**Stage Check 2.2 (恢复点 — data_complete 验收)**：
```bash
cd Scripts
# 第一次运行（应有 akshare 请求时间）:
time .venv/bin/python cli/data_complete.py --source akshare --type stocks > /dev/null
# 第二次运行（应 < 100ms，从缓存读取）:
time .venv/bin/python cli/data_complete.py --source akshare --type stocks > /dev/null
```

---

## 阶段 3：聚宽 JoinQuant Provider

**目标**：新增聚宽数据源，替换 stock-sdk 作为历史数据主源。

> 前置条件：注册 JoinQuant 免费版，获取 API Key/Secret。
> 暂停点：若未注册，可在此阶段暂停，注册后从 Stage Check 3.1 恢复。

**改动文件**：
- `Service/src/providers/joinquant/joinquantClient.ts` — **新建**，HTTP 客户端
  - 封装聚宽 REST API（或 JQData SDK 的 HTTP 化调用）
  - 密钥存 `settingsService`（`GET /api/settings` 可配）

- `Service/src/providers/joinquant/joinquantFundProvider.ts` — **新建**，实现 `FundProvider`
  - 仅实现 `navHistory()` 和 `rankHistory()`（聚宽没有实时估值）
  - 聚宽因子数据计算同类排名

- `Service/src/providers/joinquant/joinquantMarketProvider.ts` — **新建**，实现 `MarketProvider`
  - 仅实现 `kline()`（日 K 线）
  - 数据格式标准化为 `KlineDto[]`

**Stage Check 3.1** (provider 新建后):
```bash
cd Service && npm run typecheck && npm run lint
```

**改动文件**：
- `Service/src/services/fundService.ts`
  - `getFundNavHistory` chain: `[jqFundProvider, ...原链]`
  - `getFundRankHistory` chain: `[jqFundProvider, ...原链]`
- `Service/src/services/marketService.ts`
  - `getMarketKline` chain: `[jqMarketProvider, tencentMarketProvider, stockSdkMarketProvider, eastMoneyMarketProvider, akshare]`

**Stage Check 3.2 (恢复点 — 全链验收)**：
```bash
cd Service && npm run typecheck && npm run lint && npm test
# 手动验证:
# curl http://localhost:3100/api/fund/019667/nav-history
# curl http://localhost:3100/api/market/kline?symbol=000001&period=daily
# 确认 provider 返回 "joinquant"
```

---

## 阶段 4 (可选)：腾讯 FundProvider

**目标**：补全腾讯基金净值/估值能力，作为 FundProvider 链的快速备选。

**改动文件**：
- `Service/src/providers/tencent/tencentFundProvider.ts` — **新建**，实现 `FundProvider`
  - `estimate()`: `web.ifzq.gtimg.cn/app/fund/funddaily?code=...`
  - `navHistory()`: 同上 + 日期范围
  - 其他方法不实现，由 chain 自动降级

- `Service/src/services/fundService.ts`
  - 各 chain 第一顺位插入 `tencentFundProvider`（仅低于 jq）

**Stage Check 4.1**:
```bash
cd Service && npm run typecheck && npm run lint && npm test
```

---

## 文件变更汇总

| 阶段 | 操作 | 文件 |
|------|------|------|
| 0 | 修改 | `Service/src/core/providerChain.ts` |
| 0 | 修改 | `Service/src/services/marketService.ts` |
| 0 | 修改 | `Service/src/services/fundService.ts` |
| 1 | **新建** | `Service/src/providers/tencent/tencentMarketProvider.ts` |
| 1 | 修改 | `Service/src/services/marketService.ts` |
| 2 | **新建** | `Scripts/cli/shared/file_cache.py` |
| 2 | 修改 | `Scripts/cli/data_complete.py` |
| 3 | **新建** | `Service/src/providers/joinquant/joinquantClient.ts` |
| 3 | **新建** | `Service/src/providers/joinquant/joinquantFundProvider.ts` |
| 3 | **新建** | `Service/src/providers/joinquant/joinquantMarketProvider.ts` |
| 3 | 修改 | `Service/src/services/fundService.ts` |
| 3 | 修改 | `Service/src/services/marketService.ts` |
| 4 (可选) | **新建** | `Service/src/providers/tencent/tencentFundProvider.ts` |
| 4 (可选) | 修改 | `Service/src/services/fundService.ts` |

---

## 中断恢复指南

1. `git status` — 查看当前有改动的文件，对照上表确认进度
2. 从对应阶段的 Stage Check 命令恢复
3. 若 Stage Check 通过：跳到下一阶段
4. 若 Stage Check 失败：修复后重新执行本阶段
