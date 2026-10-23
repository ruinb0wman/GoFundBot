# 组件抽离计划（已归档）

> 本计划已执行完毕，2026-10-24 归档。后续演进在 `~/Workspace/ui`（`DESIGN.md` + 该仓 VitePress 文档站）。

## 结果

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 一 | 把 `frontend/src/components/` 的基础组件抽成 monorepo 子包 `packages/ui` | ✅ 2026-09 完成 |
| 二 | 升级为跨项目组件库：单一视觉尺度 + 四套语义主题 + 三档密度 | ✅ 迁到仓外 `~/Workspace/ui`（`@ruinb0w/ui`） |
| 三 | 文档与 AI 清单同源（`src/ai/registry.ts` → VitePress 组件页 + `AI.md` / `ai/manifest.json`） | ✅ |
| 四 | 存量组件按规范重写（裸 px → token、`size` 分支 → 密度档、浮层的焦点陷阱/ESC） | ⏳ 在 `~/Workspace/ui` 推进 |

## 仍在 GoFundBot 里的组件

与业务/路由耦合，按「壳上移、容器留项目」处理后再迁：

| 组件 | 耦合点 | 解耦方式 |
| --- | --- | --- |
| `AlertBadge` | `alertStore`（Pinia）+ `useNotification` | 告警数据改 props / 插槽注入 |
| `MobileDrawer` | 硬编码导航项 + `useRouter` | 导航项改 props |
| `BottomNav` | `useRoute` / `useRouter` / `useBreakpoint` | 导航项改 props |
| `HamburgerButton` | 与 MobileDrawer 配套 | 随其一起迁 |

## 迁移时的验证记录（2026-10-24）

- `frontend`：`vue-tsc --noEmit` 通过、`vitest` 289 通过、`vite build` 通过。
- dev：`main.ts` 解析到 `/@fs/home/ruinb0w/Workspace/ui/src/index.ts`；改动 UI 源码后 dev 服务器返回内容随之变化（确认读的是仓外源码而非旧 `dist`）。
- 对比改前备份：`~/Workspace/_backup/packages-ui-20261024-0031-adbdd76.tgz`（git rev `adbdd76`）。
