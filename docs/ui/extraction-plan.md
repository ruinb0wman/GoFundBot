# UI 组件库抽离计划

## 一、目标

为提升前端组件复用性，将 `Frontend/src/components/` 中的自定义基础组件抽离为独立 UI 库：

- **形态**：monorepo workspace 子包 `packages/@gofund/ui`
- **构建**：Vite lib mode（组件级 chunk + dts 生成，支持按需导入）
- **主题**：CSS 变量 token 体系（明暗双主题，源自 `Frontend/src/App.css`）

## 二、抽离清单

| 状态 | 组件 | 说明 |
|------|------|------|
| ✅ 首批已抽离 | B* 系列表单控件 + 浮层/反馈组件 | 已迁移至 `packages/@gofund/ui`：BButton、BInput、BInputNumber、BDatePicker、BTimePicker、BRadio、BRadioGroup、BCheckbox、BSwitch、BFileInput、BaseModal、BDialog、BCard、SkeletonCard、SkeletonChart、ErrorBoundary、OfflineBanner（含 LucideIcon、useOnlineStatus） |
| ⏳ 待后续处理 | AlertBadge、MobileDrawer、BottomNav、HamburgerButton | 与业务/路由耦合，需先解耦（详见下一节） |

### 首批抽离组件分组（已迁移至 `packages/@gofund/ui`）

- **表单控件（B* 系列）**：`BButton` `BInput` `BInputNumber` `BDatePicker` `BTimePicker` `BRadio` `BRadioGroup` `BCheckbox` `BSwitch` `BFileInput`
- **浮层与反馈**：`BaseModal` `BDialog` `BCard` `SkeletonCard` `SkeletonChart` `ErrorBoundary` `OfflineBanner`

#### 包结构与接入方式

- **构建**：Vite lib mode（`preserveModules` 组件级 chunk + `vite-plugin-dts` 类型产物）
- **样式**：`@gofund/ui/style.css` 聚合输出设计 token（明暗双主题）+ 基线样式；组件级 scoped 样式压缩进同文件
- **入口**：`src/index.ts` 命名导出全部组件 + `GofundUI` 全局注册插件（`app.use(GofundUI)`）；tokens/composables 均导出
- **Frontend 消费**：`file:../packages/ui` 依赖 + Vite/TS 别名直连包源码（`@gofund/ui` → `packages/ui/src/index.ts`），开发 HMR 与构建 tree-shaking 均从源
- **命令**（`cd packages/ui`）：`npm run dev/build/typecheck/lint/test`

## 三、待后续处理组件 —— 暂缓原因与解耦建议

以下组件与业务逻辑/路由强耦合，暂缓抽离。处理时先按建议解耦，再迁移进库。

- **AlertBadge**（告警铃铛）
  - 耦合点：依赖 `alertStore`（Pinia）+ `useNotification`
  - 解耦建议：将告警规则数据抽象为 props/插槽外部注入（规则列表、启用切换、检查触发回调），组件仅负责展示与交互。
- **MobileDrawer**（移动端抽屉导航）
  - 耦合点：硬编码路由导航项 + 依赖 `useRouter`
  - 解耦建议：将 `items` 导航配置改为外部 props 传入，点击回调由父组件提供。
- **BottomNav**（移动端底部导航）
  - 耦合点：依赖 `useRoute`/`useRouter`/`useBreakpoint`
  - 解耦建议：导航项外部注入，激活态判断与跳转逻辑上移至调用方。
- **HamburgerButton**（汉堡按钮）
  - 耦合点：本身较纯（props: `isOpen` + emit: `toggle`），无直接业务依赖
  - 解耦建议：仅与 MobileDrawer 配套使用，建议随 MobileDrawer 一起迁移。

## 四、后续规划

- 通用 composables（`useTheme` / `useBreakpoint` / `useDebouncedWatch` / `useDataPoller` / `useOnlineStatus` / `useNotification`）按需纳入包内 `composables/`。
- CSS 设计 token（颜色/圆角/阴影/间距/字号）沉淀为 token 体系，消除 `useEChartsTheme.ts` 中与 CSS 变量重复的硬编码 hex。
- 组件级文档将新增至本目录（`docs/ui/`），每个组件一个 `.md`（props/events/slots/demo）。

## 五、进展同步

- 首批 17 个组件已于 2026-08-26 完成迁移（`packages/@gofund/ui@1.0.0`），Frontend 全量回归通过（typecheck/lint/131 tests/build）。
- 抽离进展同步更新至根目录 `README.md` 的「🧩 UI 组件库抽离计划」一节，与本文档保持同步。
