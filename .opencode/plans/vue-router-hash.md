# vue-router Hash 模式迁移 — 完成

## 最终架构

```
App.vue (layout shell, 持久)
├─ <header> 标题 · 搜索 · 导航 tab · 返回 · 主题切换
├─ <main>
│   ├─ [v-if] 仪表盘三栏 (sidebar | router-view | rightbar)
│   │   ├─ <FundWatchlist>        ← 自选侧栏
│   │   ├─ <FundComparison>       ← 对比模式（替换 router-view）
│   │   │  └─ <router-view>       ← 页面组件
│   │   └─ <FlashNews><SectorRank> ← 右侧栏
│   └─ [v-else] 默认/full-width
│       ├─ <FundWatchlist>        ← 可选显隐
│       └─ <router-view>
└─ <footer>
```

## 路由表

| 路径 | name | 组件 | sidebar | rightbar |
|------|------|------|---------|----------|
| `/` | `dashboard` | DashboardView | ✓ | ✓ |
| `/fund/:code` | `fund-detail` | FundDetailView | ✓ | ✓ |
| `/screening` | `screening` | ScreeningView | ✗ | ✗ |
| `/backtest` | `backtest` | BacktestView | ✓ | ✗ |
| `/backtest/:code` | `backtest-fund` | BacktestView | ✓ | ✗ |
| `/portfolio` | `portfolio` | PortfolioView | ✗ | ✗ |
| `/research` | `research` | ResearchView | ✗ | ✗ |

## 页面组件

| 文件 | 包装组件 | 事件转发 |
|------|---------|---------|
| `src/views/DashboardView.vue` | MarketOverview | — |
| `src/views/FundDetailView.vue` | FundDetail | `@navigate-to-fund` |
| `src/views/ScreeningView.vue` | FundScreening | `@view-fund` |
| `src/views/BacktestView.vue` | FundBacktest | — |
| `src/views/PortfolioView.vue` | FundRealtime | `@view-detail` |
| `src/views/ResearchView.vue` | ResearchDashboard | `@view-fund` |

所有事件经 `<router-view v-slot>` 冒泡到 App.vue，由 `handleNavigate` 统一处理（含 compareMode 守卫）。

## 状态管理

- **URL**: 路由驱动（hash）— 首页 `/#/`，基金详情 `/#/fund/000001`
- **对比模式**: keep 在 App.vue 局部 ref，不塞 URL
- **历史回退**: 浏览器原生 history API（`router.back()`）

## 变更文件

```
M Frontend/package.json          +vue-router@4 依赖
A Frontend/src/router/index.js   新建，7 条 hash 路由
M Frontend/src/main.js           注册 router，router.isReady() 延迟挂载
M Frontend/src/App.vue           重写为 layout shell，删 200+ 行模板
A Frontend/src/views/DashboardView.vue
A Frontend/src/views/FundDetailView.vue
A Frontend/src/views/ScreeningView.vue
A Frontend/src/views/BacktestView.vue
A Frontend/src/views/PortfolioView.vue
A Frontend/src/views/ResearchView.vue
```
