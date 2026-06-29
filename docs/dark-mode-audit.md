# 深色模式审计报告

> 生成: 2026-06-29
> 方法: rg 扫描 Frontend/src/ 下所有 .vue 文件的 style 块

## 已修复

| 文件 | 行 | 原值 | 修复后 |
|------|-----|------|--------|
| FundScreening.vue | 1936 | `color: rgb(50, 53, 218)` | `var(--text-inverse)` |
| MobileDrawer.vue | 132 | `color: #fff` | `var(--text-inverse)` |

## 硬编码颜色白名单 (经确认不需要改动)

| 文件 | 行 | 色值 | 原因 |
|------|-----|------|------|
| App.vue | 450 | `#fff` | Header 搜索框, 固定 gradient 背景 |
| App.vue | 444-556 | `rgba(255,255,255,x)` | Header 元素, 固定 gradient 背景 |
| FundBasicInfo.vue | 338 | `#ffffff` | 深色模式 gradient header 文本 |
| FundBasicInfo.vue | 339-354 | `rgba(255,255,255,x)` | Gradient header 毛玻璃效果 |
| FundBasicInfo.vue | 347, 350, 365, 371 | `#ffd700` | 金色语义色 (星标/涨跌标识) |
| FundPortfolio.vue | 97-99 | `#ffd700/#c0c0c0/#cd7f32` | 金/银/铜牌 rank 语义色 |
| FundSameType.vue | 98-100 | `#ffd700/#c0c0c0/#cd7f32` | 金/银/铜牌 rank 语义色 |
| SectorRank.vue | 590-601 | `#ffd700/#c0c0c0/#cd7f32` | 金/银/铜牌 rank 语义色 |
| OfflineBanner.vue | 27 | `#fff` | 危险横幅 (`--color-danger` bg) |
| FundBacktest.vue | 1015 | `rgba(255,255,255,0.9)` | Highlight card 标签 (gradient bg) |
| FundScreening.vue | 2509 | `rgba(255,255,255,0.7)` | 筛选页特定 dark bg 区域 |
| FundAbilityEval.vue | 202 | `rgba(255,255,255,0.8)` | 雷达图标记 (gradient bg) |
| FundEvaluation.vue | 360 | `rgba(255,255,255,0.8)` | 评分卡文本 (gradient bg) |
| MarketDashboard.vue | 111 | `rgba(255,255,255,0.85)` | 大盘文字 (gradient bg) |

## JS 内 cssColor() fallback (使用 `--var` 优先, 硬编码 fallback 仅后备)

Chart/radar 组件共 13 处使用 `cssColor(name, fallback)` 模式, fallback 色值仅当 CSS 变量不可用时生效, 不影响深色模式。

## 结论

深色模式适配程度: **完全适配** ✅

CSS 变量体系覆盖全组件, 仅 2 处硬编码色值在非强制暗背景上使用, 已全部修复。
