# 运行时与配置

> 数据源本身（每个 provider 用哪个接口、能拿什么）见 [数据源](/architecture/data-sources) 与
> [回退策略](/architecture/fallback-strategy)；架构全貌见 [Node 核心架构](/architecture/node-core)。

## 1. 运行时分布

| 运行时 | 位置 | 角色 | 端口 |
|---|---|---|---|
| Node.js (TS) | `service/src/` | Express：数据获取（ProviderChain）、SQLite 存储、计算（调 `packages/core`）、工具面 `/api/agent/*`、代码沙箱 | 8310（仅 `127.0.0.1`） |
| Node.js (TS) | `frontend/src/` | Vue 3：展示与工作台；计算来自 `@gofund/core`；数据走 HTTP | 8517 |
| Node.js (TS) | `packages/core/` | 两端共用的纯计算内核（不单独运行） | — |
| Python 3 | `python/cli/` | 数据补全脚本，由 `pythonRunner.ts` 用 `child_process.spawn()` 调用（stdin/stdout JSON） | — |
| Node.js (TS) | `docs/` | VitePress 文档站 | 8574（经前端 `/docs/*` 代理） |
| 终端 pi | `.pi/` | 唯一 AI 层：工具桥 + 技能 | — |

## 2. 起停

```bash
bun dev                      # 仓库根目录：一键起 service + frontend + docs
cd service && bun run dev    # 只起 service（tsx watch，改代码即热重载）
cd frontend && bun run dev   # 只起前端
```

- `service` 支持 `SIGTERM`/`SIGINT` 优雅退出（10s 等待，期间关闭 SQLite 连接）。
- 健康检查：`GET /api/health` —— 含内存缓存统计与 SQLite 净值缓存计数（`nav_cache`）。

## 3. 环境变量

> 运行时下限：**Node ≥ 22.19**（`engines`，由 `undici@8` 决定）；内置 `node:sqlite` 自 22.13 起免 flag。
> 启动时会探测 `node:sqlite` 可用性，不满足直接报人话退出（`service/src/index.ts`）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8310` | service 端口（前端 Vite 代理指向它） |
| `HOST` | `127.0.0.1` | 监听地址；**改它等于把用户数据暴露到局域网** |
| `GOFUND_DB_PATH` | `service/data/gofund.db` | SQLite 路径；测试用 `:memory:` |
| `CORS_ORIGINS` | 前端 dev 源 | 允许的跨域来源（Electron 壳不需要） |
| `HTTP_PROXY` / `HTTPS_PROXY` | 空 | 代理；**只有明确要走的调用**用它（Yahoo 兜底、搜索结果、Binance 直连失败后的重试）。东财/腾讯/黄金/币安主路径一律 `proxy: 'never'` = 真直连（2026-10-09 修正：以前 `never` 会落到全局 `EnvHttpProxyAgent`，等同仍过代理） |
| `LOG_DIR` | `python/Data/logs` | 结构化日志目录（`dataservice-YYYY-MM-DD.jsonl`） |
| `CACHE_MAX_ENTRIES` | `2000` | 内存缓存条数上限 |
| `GOFUND_API_BASE` | `http://localhost:8310` | **pi 扩展**用的 service 地址 |

设置页能改的只有 **proxy URL**（`GET/PUT /api/settings`，落 SQLite；空串=不修改，`clearProxy: true` 才清除）。

## 4. 缓存与限流

| 层 | 位置 | TTL / 行为 |
|---|---|---|
| 内存缓存 | service（`core/cache.ts`） | 行情 15s / 基金估值 30s / 历史 24h / 分红 7d；`/api/health` 可见条数 |
| SQLite 净值缓存 | `nav_history` + `nav_history_meta` | 覆盖度判断（窗口在过去 → 永久；窗口到今天 → 24h 内）；保留最近 10 年，全库 >300 万行按 `fetched_at` LRU 整只淘汰（`/api/health` 报 `trimmed`/`evicted`） |
| SQLite 筛选库 | `screening_funds` | 富化结果长期保留；`risk_attempted` 防重复重试；整表读走**进程内缓存**（写库即失效） |
| 投研看板 | 进程内 | 60s，key 含筛选库数据版本（同步/富化/排名后失效） |
| 限流 | `express-rate-limit` | 300 请求 / 15 分钟（本地单用户足够；批量富化走单请求内的并发）；**`/api/agent/*` 单独 3000/15 分钟** |

## 5. 数据源与回退（要点）

- **市场行情**：stock-sdk → eastmoney；**基金**：joinquant → tencent → stock-sdk → eastmoney。
- **代理与直连（2026-10-09 修正）**：`proxy: 'never'` 现在是**真直连**（以前返回 `undefined` = 随全局
  `EnvHttpProxyAgent`，标了直连其实仍过代理）；东财/腾讯/币安/黄金 一律直连，只有 Yahoo 兜底与搜索走代理。
  东财请求另有**端点级熔断**（连续 3 次失败 → 冷却 60s，日志 `eastmoney breaker open`）——见 [回退策略](/architecture/fallback-strategy)。
- **曾被认为「被反爬切断」的接口**（行业板块列表、大盘资金流）在真直连下多数可用，但仍会限流；
  同花顺/腾讯/Python（akshare）的回退链继续保留 —— 见 [回退策略](/architecture/fallback-strategy) 与
  [数据源](/architecture/data-sources) 里的「已知问题」。
- **口径陷阱**（北向净流入恒为 null、涨跌停家数可能为 null、概念板块 `event_date` 不是行情日期）在
  [pi 工具面](/architecture/pi-tools) 与技能文档里都有说明；工具返回的 `data_status: unavailable` **不要当 0**。

## 6. Python 侧

```bash
python/.venv/bin/python cli/data_complete.py --source akshare --type stocks   # 数据补全
python/.venv/bin/python cli/fetch_fund.py --code 019667                       # 单只基金
```

Python 只被 service 当作「取数工具」调用（`stdin: JSON → stdout: JSON`），**不对外提供 HTTP**；
新增脚本放在 `python/cli/`，由 `service/src/services/pythonRunner.ts` 调用。
