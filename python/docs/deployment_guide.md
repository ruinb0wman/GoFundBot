# GoFundBot 部署与灰度测试指南

## 1. 启动 Service

```bash
cd Service
npm install
cp .env.example .env        # 首次部署
npm run build               # 生产构建
npm start                   # 生产启动（端口 8310）

# 或开发模式
npm run dev                 # tsx watch，自动重载
```

验证：
```bash
curl http://localhost:8310/api/health
# → {"success":true,"data":{"status":"ok","service":"gofund-data-service"},...}
```

## 2. 启动 Scripts

```bash
cp Scripts/.env.example Scripts/.env   # 首次部署，按需修改 API Key

# Windows PowerShell
$env:DATA_SERVICE_BASE_URL="http://localhost:8310/api"
$env:FUND_DEFAULT_SOURCE="legacy"
python Scripts/app.py

# Linux / macOS
export DATA_SERVICE_BASE_URL=http://localhost:8310/api
export FUND_DEFAULT_SOURCE=legacy
python Scripts/app.py
```

验证：
```bash
curl http://localhost:5000/api/data-service/health
# → {"success":true,"data":{"status":"ok",...}}
```

## 3. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATA_SERVICE_BASE_URL` | `http://localhost:8310/api` | Service 地址 |
| `DATA_SERVICE_TIMEOUT` | `5` | 请求超时（秒） |
| `FUND_DEFAULT_SOURCE` | `legacy` | 基金详情默认数据源 |

## 4. 测试三种数据源模式

### 4.1 legacy — 旧数据源
```bash
curl "http://localhost:5000/api/fund/161725?source=legacy"
```
行为：走 `fund_api.py` → pingzhongdata / fundgz，**与升级前完全一致**。

### 4.2 data_service — 新数据源
```bash
curl "http://localhost:5000/api/fund/161725?source=data_service"
```
行为：调用 Service `/funds/:code/detail` → `data_service_legacy_mapper.py` 映射为旧结构返回。
Response 顶部包含 `_data_source` debug meta。

### 4.3 auto — 灰度模式
```bash
curl "http://localhost:5000/api/fund/161725?source=auto"
```
行为：
1. 请求 Service detail
2. 通过 legacy mapper 映射
3. 质量门禁检查（7 项）
4. 通过 → 返回 mapped 数据 + `_data_source.quality_passed=true`
5. 不通过 → **自动 fallback 到 legacy**

### 4.4 默认模式（无 source 参数）
```bash
curl "http://localhost:5000/api/fund/161725"
```
行为：读取 `FUND_DEFAULT_SOURCE` 环境变量，当前推荐 `legacy`。

## 5. 当前推荐配置

```
FUND_DEFAULT_SOURCE=legacy
```

**原因**：
- 默认走旧数据源，前端行为完全不变。
- 灰度验证通过 `?source=auto` 或 `?source=data_service` 显式触发。
- 只有灰度充分验证后，才考虑将 `FUND_DEFAULT_SOURCE` 改为 `auto`。

## 6. 批量灰度测试

```bash
# 内置 6 只样本基金（指数型/债券型/混合型/货币型/QDII/ETF）
python Scripts/scripts/compare_fund_source_modes_batch.py

# 指定基金
python Scripts/scripts/compare_fund_source_modes_batch.py --fund-codes 161725,110022,000001

# 合约完整度对比
python Scripts/scripts/compare_data_service_contract.py --fund-code 161725

# 单基金三模式对比
python Scripts/scripts/compare_fund_source_modes.py --fund-code 161725
```

## 7. 切换 FUND_DEFAULT_SOURCE 的前提条件

在将 `FUND_DEFAULT_SOURCE` 从 `legacy` 改为 `auto` 之前，必须满足：

1. **批量测试全部通过**：`compare_fund_source_modes_batch.py` 覆盖的所有基金类型质量门禁通过。
2. **合约完整度 ≥ 70%**：`compare_data_service_contract.py` 输出 blocking_fields=0。
3. **前端回归测试通过**：在灰度环境用 `source=auto` 测试所有基金详情页面。
4. **Service 稳定运行**：无频繁超时或 5xx。
5. **回滚方案就绪**：可随时设置 `FUND_DEFAULT_SOURCE=legacy` 切回旧源。

## 8. 回滚

```bash
# 立即切回旧数据源
export FUND_DEFAULT_SOURCE=legacy
# 重启 Flask
```

旧模块（`fund_api.py`、`fund_list_cache.py`、`stock_service.py` 等）全部保留，随时可用。
