# 筛选面板

## 一、组件结构

```
FundScreening.vue
├── .screening-header (顶部状态栏)
│   ├── .header-left
│   │   ├── stat-chip: 基金总数
│   │   ├── stat-chip.complete: 完整数据数
│   │   └── update-time-chip: 最后更新时间
│   └── .header-right
│       ├── doc-link: 文档图标
│       └── BButton: 更新数据
├── .inline-update-bar (更新进度条，更新中显示)
├── .screening-panel (筛选面板)
│   ├── .filter-bar
│   │   ├── SearchBar: 关键词搜索（代码/名称/拼音）
│   │   ├── type-select-wrap: 基金类型下拉
│   │   ├── BButton: 查询
│   │   └── BButton: 清空
│   ├── .selected-types-tags: 已选类型标签
│   └── .filter-section (标签筛选区)
│       ├── .filter-zone: 基金大类标签
│       ├── .filter-zone: 行业/市场板块标签
│       └── .advanced-section: 高级筛选条件
├── .results-section (结果区域)
│   └── vxe-grid: 可排序表格
└── .pagination: 分页控件
```

## 二、筛选维度

### 2.1 基金类型选择

类型分 3 个大类（`useFundScreening.ts:175`）：

| 大类 | 包含子类型 | 图标 |
|------|-----------|------|
| 偏股型 | 偏股混合、灵活配置、平衡混合、股票型、股票指数、联接基金 | `TrendingUp` |
| 偏债型 | 偏债混合、长期纯债、中短债、债券型(全部)、债券指数 | `BarChart3` |
| 货币/其他 | 货币型、FOF、QDII、QDII指数、REITs | `💰` |

- 点击大类全选/取消，可展开后单独勾选子类型
- 已选类型显示为可删除标签（`selected-types-tags`）

### 2.2 行业标签筛选

数据来源：`GET /api/screening/industry-tags` → 后端 `enrichmentMap` 统计。

一级标签（基金大类）：根据 `industry_tag_name` 聚合，展示基金数量。

二级子标签：展开一级标签后展示细分标签。

行业板块分组（后端 `screening.routes.ts:260`）：

| 分组 | 包含标签 |
|------|---------|
| 医药医疗 | 医药医疗 |
| 新能源 | 新能源、新能源汽车 |
| 科技 | 科技、半导体/芯片、人工智能、通信 |
| 消费 | 消费 |
| 金融地产 | 金融地产 |
| 军工 | 军工 |
| 周期 | 周期 |
| 宽基指数 | 宽基指数、红利 |
| 固收 | 固收、货币 |
| 海外 | 海外 |
| 环保 | 环保/碳中和 |
| 黄金 | 黄金/贵金属 |

前端兜底分类（`fallbackSectorBuckets`）见 data-flow.md。

### 2.3 高级筛选条件

3 组筛选条件（`useFundScreening.ts:120`）：

| 分组 | 条件 | 类型 |
|------|------|------|
| 收益表现 | 近1/3/6月收益率、近1/3年收益率、1/3年年化收益率 | 范围 (min~max) |
| 风险控制 | 近3/6月/1/3年最大回撤、1/3年波动率、1/3年夏普比率、1/3年卡玛比率 | 上限/下限 |
| 同类排名 | 近1/3/6月排名百分位、近1/2/3年排名百分位、4433法则 | 上限 + 复选框 |

## 三、筛选执行

筛选条件定义在 `filters` 响应式对象（`useFundScreening.ts:163`），查询逻辑在 `useScreeningDb.queryFunds()`（`useScreeningDb.ts:225`）：

```typescript
async function queryFunds(filters, sortBy, sortOrder, page, pageSize):
  // 1. IndexedDB where 子句: fund_types 或 pass_4433
  // 2. 内存 filter: industry_tags / return_* / rank_pct_* / sharpe_ratio / calmar / keyword 等 30+ 条件
  // 3. 内存 sort: 按指定字段 + 升降序
  // 4. 分页切片: (page-1)*pageSize ~ page*pageSize
```

### 3.1 条件优先级

1. `pass_4433=1` → IndexedDB 索引过滤
2. `fund_types` 任意匹配 → IndexedDB `anyOf` 过滤
3. 全量数据 → 内存 filter

### 3.2 高级条件矩阵

| 条件 | 比较方向 | 用于 |
|------|---------|------|
| `return_*_min` / `return_*_max` | between | 收益筛选 |
| `sharpe_ratio_*_min` | >= | 风险调整收益下限 |
| `calmar_ratio_*_min` | >= | 卡玛比率下限 |
| `max_drawdown_*_max` | <= | 最大回撤上限 |
| `volatility_*_max` | <= | 波动率上限 |
| `rank_pct_*_max` | <= | 排名百分位上限 |

## 四、结果表格

使用 `vxe-grid` 组件（`FundScreening.vue:345`），支持列排序（点击表头触发 `sort-change` 事件）。

列定义包含：

| 列 | 说明 | 格式化 |
|----|------|--------|
| fund_code | 基金代码 | — |
| fund_name | 基金名称 | 截断显示 |
| fund_type | 基金类型 | — |
| industry_tag_name | 行业标签 | 圆角标签样式 |
| return_1m~3y | 各区间收益率 | + 红色 / - 绿色 |
| max_drawdown_1y | 最大回撤 | 绿色（负值） |
| sharpe_ratio_1y | 夏普比率 | 优秀/良好/一般/差 着色 |
| calmar_ratio_1y | 卡玛比率 | 同上 |
| pass_4433 | 4433通过标记 | 勾选/横杠 |
| actions | 自选 + 对比 | 按钮组 |

特殊渲染：
- `getReturnClass()`: 正数采用 `--color-danger`（A 股红涨绿跌），负数采用 `--color-success`
- `getSharpeClass()`: 夏普 >1.5 绿色优秀，>1 蓝色良好，>0.5 灰色正常，≤0.5 浅色差
- `pass_4433`: 1 显示绿色勾，0 显示灰色横杠

## 五、分页与排序

- 每页 20 条
- 排序在前端执行（IndexedDB 查询后内存排序）
- 默认按 `return_1y` 降序
