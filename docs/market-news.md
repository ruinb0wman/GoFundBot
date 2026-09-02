# 7×24 快讯 (Flash News)

## 一、概述

聚合东方财富、百度股市通、财联社三家财经快讯，去重后按时间倒序排列，支持无限滚动加载和详情弹窗。

## 二、数据流路径

```
GET /api/news/flash?count=50&page=1
  → news.routes.ts → getFlashNews()
    → 并行请求三家 Provider
      ├── EastMoneyNewsProvider — newsapi.eastmoney.com
      ├── BaiduNewsProvider — finance.pae.baidu.com
      └── ClsNewsProvider — www.cls.cn
    → 合并、去重（按标题）、排序（时间倒序）、分页
    → 返回 { items, total, hasMore }
  → 前端 FlashNews.vue → dataPoller + 无限滚动
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/news.routes.ts:8` | `GET /api/news/flash` |
| service | `service/src/services/newsService.ts:12` | `getFlashNews()` 编排 |
| Provider | `service/src/providers/eastmoney/eastmoneyNewsProvider.ts:7` | 东方财富快讯 |
| Provider | `service/src/providers/eastmoney/eastmoneyNewsProvider.ts:33` | 百度股市通快讯 |
| Provider | `service/src/providers/eastmoney/eastmoneyNewsProvider.ts:78` | 财联社快讯 |
| frontend API | `frontend/src/services/api.ts:84` | `getFlashNews()` |
| frontend 渲染 | `frontend/src/components/FlashNews.vue` | 快讯列表+弹窗 |

## 三、数据源详情

### 3.1 东方财富

| 项 | 说明 |
|----|------|
| 端点 | `https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_{count}_1_.html` |
| 解析 | 正则提取 `ajaxResult = {...}` 包裹的 JSON |
| 字段 | `title`, `digest`(摘要), `showtime`(时间) |
| 来源标签 | `东方财富` |

### 3.2 百度股市通

| 项 | 说明 |
|----|------|
| 端点 | `https://finance.pae.baidu.com/selfselect/expressnews?rn={count}&pn=0&tag=A股` |
| 解析 | JSON: `Result.content.list[]` |
| 字段 | `title`, `evaluate`(利好/利空), `publish_time` |
| 来源标签 | `百度股市通` |

### 3.3 财联社

| 项 | 说明 |
|----|------|
| 端点 | `https://www.cls.cn/nodeapi/telegraphList?app=CailianpressWeb&rn={count}` |
| 解析 | JSON: `data.roll_data[]` |
| 字段 | `content`, `brief`(摘要), `ctime`(时间戳) |
| 来源标签 | `财联社` |

## 四、服务端处理

| 步骤 | 说明 |
|------|------|
| 1. 并行请求 | `Promise.allSettled` 同时请求三家 Provider |
| 2. 合并 | 所有结果合并到一个数组 |
| 3. 去重 | `Set<string>` 按标题去重 |
| 4. 排序 | `publishedAt` 降序（最新在前） |
| 5. 分页 | `(page-1) * count` 切片，返回 `hasMore` 标志 |

## 五、前端渲染

| 项 | 说明 |
|----|------|
| 组件 | `frontend/src/components/FlashNews.vue` |
| Composable | `FlashNews.vue` 自有逻辑 + `useDataPoller` |
| 列表 | TransitionGroup 动画，新条目闪烁 "is-new" 高亮 |
| 无限滚动 | `@scroll` 事件，距底部 80px 自动加载更多 |
| 分页加载 | 先显示本地缓冲，用完再请求下一页 |
| 详情弹窗 | Teleport 模态框，展示全文、来源、关联个股 |
| 时间显示 | 相对时间（刚刚/X分钟前/X小时前/昨天） |
| 轮询间隔 | 每 60s 增量拉取最新快讯 |

## 六、缓存配置

服务端无缓存（每次请求都从三家源站实时拉取）。

前端 `useDataPoller` 每 60s 拉取增量数据，合并到本地 `newsList`。

## 七、已知问题

1. **接口不稳定**：东方财富 kuaixun 接口格式偶有变动，JSONP 解析敏感。
2. **标题截断**：列表显示截断 35 字，详情弹窗可看全文。
3. **无历史留存**：仅保留当前会话的新闻列表，刷新页面后重新加载。
