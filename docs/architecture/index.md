# 技术架构总览

GoFundBot 是一个**本机跑**的基金分析工具：数据与计算在 Node 后端（`service`），页面只做展示与工作台，AI 由终端 pi 承担。

> 详细说明看 **[Node 核心架构](/architecture/node-core)**（服务分层、SQLite schema、共享内核、数据流、踩坑）。
> 本页只是一张地图。

## 进程

| 进程 | 端口 | 是什么 |
|---|---|---|
| `service` | 8310 | Node + Express：数据获取（ProviderChain）、SQLite 存储、计算（调 `packages/core`）、工具面 `/api/agent/*`、策略代码沙箱。**不做 LLM、不持密钥**，只绑 `127.0.0.1` |
| `frontend` | 8517 | Vue 3 + Vite：筛选面板 / 投研看板 / 回测工作台 / 策略页 / 持仓。计算来自 `@gofund/core`，数据走 HTTP（`/api` 由 Vite 代理） |
| `docs` | 8574 | VitePress 文档站（经前端 `/docs/*` 代理访问） |
| Python | — | 只做数据补全（akshare/eastmoney），无 HTTP 服务，由 service `spawn` 调用 |
| 终端 pi | — | 唯一 AI 层：`.pi/extensions/gofund` 通用桥 + `.pi/skills`，全部能力通过 `/api/agent/*` |

Electron 桌面壳（外部项目，可选）只是一个解禁 CORS 的浏览器窗口，加载运行中的前端 dev 服务，代码与 Web 完全一致。

## 目录

```
service/src/     Express 应用（routes / services / providers / db / core / agent / sandbox）
frontend/src/    Vue 应用（views / components / composables / services / db(仅一次性导入)）
packages/core/   两端共用的纯 TS 计算内核（回测 / 风险指标 / 分类 / 4433 / 投研聚合）
packages/ui/     @gofund/ui 组件库（B* 系列控件 + 设计 token）
python/          数据补全脚本（CLI，stdin/stdout JSON）
docs/            本文档站
.pi/             pi 扩展（工具桥）与技能
```

## 分层职责（一句话版）

- **数据源**：`service/src/providers/`（ProviderChain 依次尝试，失败落 Python/akshare）→ 见 [数据源](/architecture/data-sources) 与 [回退策略](/architecture/fallback-strategy)。
- **存储**：service SQLite（用户数据 / 筛选库 / 净值缓存 / 设置）→ 见 [Node 核心架构#存储](/architecture/node-core#_2-存储-service-sqlite)。
- **计算**：`packages/core`（同一份源码两端共用，黄金 fixtures 双侧校验）→ 见 [回测引擎](/architecture/backtest-engine)。
- **接口**：REST（数据 + 计算 + 用户数据）+ 工具面（pi）。
- **AI**：终端 pi，工具清单来自 `GET /api/agent/tools` → 见 [pi 工具面](/architecture/pi-tools)。

## 关键取舍

- **不引入前端状态库**：用户数据不在浏览器，页面刷新即从 service 拿最新（IndexedDB 只剩一次性导入旧数据的路径）。
- **计算内核不构建 dist**：前端与 service 直连 `packages/core/src`，避免「前端源码 vs 后端产物」两套实现。
- **数据源坏了就降级**：ProviderChain + Python 回退，宁可少字段也不编数据（前端对 `data_status: unavailable` 显式提示）。
