# @gofund/ui 组件库

独立 UI 组件库，从基金前端 `Frontend/src/components/` 抽离而来（monorepo workspace `packages/ui`）。

## 接入方式

**Frontend 消费**（当前项目）：

- `Frontend/package.json` 声明 `"@gofund/ui": "file:../packages/ui"`
- `Frontend/vite.config.ts` / `vitest.config.js` / `tsconfig.json` 配置别名直连包源码：
  - `@gofund/ui` → `packages/ui/src/index.ts`
  - `@gofund/ui/style.css` → `packages/ui/src/index.css`

**独立使用**：

```ts
import { BButton, BInput, GofundUI } from '@gofund/ui'
import '@gofund/ui/style.css' // 设计 token（明暗双主题）+ 基线 + 组件 scoped 样式

app.use(GofundUI) // 或按需使用组件
```

## 组件清单

### 表单控件

| 组件 | 说明 | 主要 Props |
|------|------|-----------|
| `BButton` | 按钮，6 type（default/primary/success/warning/danger/info）× 3 size，plain/round/circle/text/link/loading/active 变体，icon 插槽 | `type size plain round circle loading disabled text link active nativeType icon` |
| `BInput` | 输入框/文本域/密码，clearable、字数限制、prefix/suffix/prepend/append 插槽、formatter/parser、拼音 composition 处理、textarea 自适应 | `modelValue type size placeholder disabled clearable showPassword showWordLimit maxlength rows autosize readonly prefixIcon suffixIcon formatter parser` |
| `BInputNumber` | 数字输入，min/max/step/precision 钳制、stepStrictly、左右控件、键盘上下键 | `modelValue min max step stepStrictly precision size disabled controls controlsPosition formatter parser valueOnClear` |
| `BCheckbox` | 复选框，indeterminate 半选、自定义插槽 | `modelValue label disabled indeterminate size` |
| `BSwitch` | 开关，active/inactive 文案、loading、键盘可达（role=switch） | `modelValue activeText inactiveText disabled loading size` |
| `BRadio` / `BRadioGroup` | 单选组（provide/inject 上下文），vertical/border 模式 | `modelValue disabled size vertical border` |
| `BDatePicker` | 原生 date 输入包装（图标 + clearable） | `modelValue placeholder disabled clearable min max size` |
| `BTimePicker` | 原生 time 输入包装（图标 + clearable） | `modelValue placeholder disabled clearable min max step size` |
| `BFileInput` | 文件选择，隐藏原生 input，trigger/file 自定义插槽 | `accept multiple disabled placeholder` |

### 浮层与反馈

| 组件 | 说明 | 主要 Props |
|------|------|-----------|
| `BaseModal` | 模态框（Teleport），header/body/footer、closeOnOverlay、body 滚动锁、移动端底部弹出 | `visible title width height closable closeOnOverlay` |
| `BDialog` | 确认选项对话框（图标选项列表，danger 变体） | `visible title subtitle options closable` |
| `BCard` | 卡片，shadow always/hover/never、渐变 header | `shadow bodyStyle header` |
| `SkeletonCard` | 骨架卡片（shimmer） | `lines widths height title` |
| `SkeletonChart` | 骨架图表（虚线走势 + 图例） | `height width` |
| `ErrorBoundary` | 渲染错误捕获 + 重试 | —— |
| `OfflineBanner` | 网络断开提示条 | —— |

### 原子与工具

- `LucideIcon`：`@lucide/vue` 包装器（peer 依赖），缺失图标名回退显示原名
- `useOnlineStatus`：浏览器 onLine/offline 监听
- tokens：`lightTokens` / `darkTokens` / `getTokens(mode)` — 与 CSS 变量同源的 TS 常量（供 ECharts 主题等 JS 侧使用）

## 主题

- 样式入口 `@gofund/ui/style.css`：`:root`（明色，Ant Design 色板 + Tailwind 灰阶）与 `:root[data-theme="dark"]`（暗色）双套设计 token，切换方式为 `document.documentElement.setAttribute('data-theme', 'dark')`
- 金融语义色约定：A 股红涨绿跌 —— 组件样式中 `.positive` 映射 `--color-danger`（红）、`.negative` 映射 `--color-success`（绿）

## 开发

```bash
cd packages/ui
npm run dev        # vite build --watch
npm run build      # vite build + vue-tsc
npm run typecheck
npm run lint       # ESLint（max-lines 500）
npm test           # Vitest（jsdom）
```

> 抽离背景与待处理组件（AlertBadge/MobileDrawer/BottomNav/HamburgerButton）见 [组件抽离计划](./extraction-plan)。
