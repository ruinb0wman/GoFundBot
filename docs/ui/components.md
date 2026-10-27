# UI 组件库（已独立成仓）

> 2026-10-24：`packages/ui` 迁出本仓，成为跨项目组件库 **`~/Workspace/ui`（包名 `@ruinb0w/ui`）**，与 bow、exp1 共用。
> 本页只留 GoFundBot 侧的接入事实；组件文档见该仓的 VitePress 站（`cd ~/Workspace/ui && bun run docs:dev`）。

## GoFundBot 里怎么用

```ts
import { RButton, RInput, RDialog } from '@ruinb0w/ui'
import '@ruinb0w/ui/style.css'   // token + 基线样式，入口引一次
```

- `frontend/vite.config.ts` / `tsconfig.json` 的两个别名都指向 `../../ui/src/index.ts`（**直连源码**，dev HMR 与 build 均从源，不走 `dist`）。
- `frontend/package.json` 的依赖声明是 `"@ruinb0w/ui": "file:../../ui"`。
- 源码在仓库外，`vite.config.ts` 的 `server.fs.allow` 已显式放行项目根与 `../../ui`。

## 主题与密度

```ts
document.documentElement.dataset.theme = 'gofund-light'   // 默认；深色 'gofund-dark'（也认 html.dark）
document.documentElement.dataset.density = 'default'      // compact 28px / default 32px / touch 44px 控件高
```

本仓历史用法 `document.documentElement.setAttribute('data-theme', 'dark')` 依然生效（`dark` 是 `gofund-dark` 的别名）。

## 规范

判据在 `~/Workspace/ui/DESIGN.md`：间距档（4/8/12/16/24/32/48）、圆角档（6/10/16）、字号档、动效两档、层级五档，
以及「只准读语义变量、禁止覆盖组件内部样式」。存量组件重写进度看该仓 `bun run lint:style` 的数字。
