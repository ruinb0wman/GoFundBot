# Phase 8: 前端增强

> 对应 `docs/优化与待完善功能清单.md` 第 8 节

---

## 执行记录

| 阶段 | 完成 | 时间 |
|------|------|------|
| Phase 1: 8.6 降级地址硬编码 | ✅ | |
| Phase 2: 8.1 搜索历史 | ✅ | |
| Phase 3: 8.3 离线检测 + 8.5 错误边界 | ✅ | |
| Phase 4: 8.4 移动端适配 | ✅ | |
| Phase 5: 验证 + 文档更新 | ✅ | |

---

## Phase 1 — 8.6 降级地址硬编码 (~10 min)

- [x] 1.1 `api.ts:11` — 将 `baseURL` 替换为 `import.meta.env.VITE_FALLBACK_API_BASE || 'http://localhost:5000/api'`
- [x] 1.2 `vite.config.ts:14` — 使用 `loadEnv` 读取环境变量代替硬编码
- [x] 1.3 添加 `Frontend/.env.example` 文档化环境变量

## Phase 2 — 8.1 搜索历史 (~20 min)

- [x] 2.1 新建 `composables/useSearchHistory.ts` — localStorage 持久化最近 10 条搜索
- [x] 2.2 `FundSearch.vue` — 输入框聚焦且为空时显示最近搜索下拉，点击/回车添加到历史

## Phase 3 — 8.3 离线检测 + 8.5 错误边界 (~30 min)

- [x] 3.1 新建 `composables/useOnlineStatus.ts` — `navigator.onLine` + `online`/`offline` 事件
- [x] 3.2 新建 `components/OfflineBanner.vue` — 离线提示横幅
- [x] 3.3 新建 `components/ErrorBoundary.vue` — `onErrorCaptured` 错误边界
- [x] 3.4 全局注册 — `App.vue` 插入 `<OfflineBanner>` 和 `<ErrorBoundary>`；`main.ts` 注册 `errorHandler`

## Phase 4 — 8.4 移动端增强 (~2h)

### 4a 基础设施

- [x] 4a.1 新建 `composables/useBreakpoint.ts` — 响应式断点 composable

### 4b 导航重构

- [x] 4b.1 新建 `components/HamburgerButton.vue` — 汉堡按钮 + X 动画
- [x] 4b.2 新建 `components/MobileDrawer.vue` — 左侧滑出抽屉导航
- [x] 4b.3 `App.vue` — 移动端隐藏 mode-switch，显示 HamburgerButton + MobileDrawer

### 4c 底部导航

- [x] 4c.1 新建 `components/BottomNav.vue` — 4 图标底部 tab 导航
- [x] 4c.2 `App.vue` — 插入 `<BottomNav>`，底部 padding 56px

### 4d 触摸适配

- [x] 4d.1 全局 CSS `min-height: 44px` for touch targets
- [x] 4d.2 表格溢出修复 `overflow-x: auto` + `-webkit-overflow-scrolling: touch`

### 4e 图表适配

- [x] 4e.1 新建 `composables/useChartResize.ts`，修复 6 个组件的 resize 处理（已泄漏 → 命名 handler；缺失 → 新增）

## Phase 5 — 验证 + 文档更新 (~15 min)

- [x] 5.1 `npx vue-tsc --noEmit` TypeScript typecheck ✅ 仅预存 FundRealtime/Screening 错误
- [x] 5.2 `npm test` 前端测试 ✅ 24/24 pass
- [x] 5.3 `npm run build` 构建验证 ✅
- [x] 5.4 更新 `docs/优化与待完善功能清单.md` — 标记 8.1/8.3/8.4/8.5/8.6 完成
- [x] 5.5 更新 `README.md` — `近期演进` 表新增前端增强行
- [x] 5.6 更新 `AGENTS.md` — `Frontend/src/` composables/components 更新

---

## 中断恢复

执行中断后，重新读取本文件找到第一个 `- [ ]` 未勾选项，从所在 Phase 继续执行。各 Phase 无顺序依赖。
