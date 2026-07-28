---
layout: home

hero:
  name: GoFundBot
  text: 智能基金分析与研究平台
  tagline: AI 驱动的基金深度研究 · 实时市场数据 · 量化筛选工具 · 全栈开源
  actions:
    - theme: brand
      text: 开始阅读
      link: /data-sources-and-runtime
    - theme: alt
      text: GitHub
      link: https://github.com/ruinb0w/GoFundBot

features:
  - title: AI 多分析师辩论
    details: 四名专业 AI 分析师（业绩、持仓、经理、市场）并行评估基金，Supervisor 综合生成 5 级评分（Strong Buy → Sell），结果带详细推理与数据支撑。
  - title: 实时市场数据
    details: ProviderChain 多源自动降级（stock-sdk → EastMoney → Tencent → Yahoo），覆盖基金净值、K 线、指数、板块、贵金属实时行情与资金流向。
  - title: 基金筛选
    details: 4433 法则、夏普比率、低波动率等预置策略 + 自定义条件筛选，结合风险指标（最大回撤、Calmar 比）和行业标签。
  - title: 定投回测
    details: 支持月定投、周定投、均线定投、价值平均等策略，Python 引擎并行计算，结果可视化呈现收益与风险表现。
  - title: LLM 智能对话
    details: ReAct 循环 + 工具调用（基金查询、Web 搜索、板块表现、市场行情），带记忆与反思系统的 AI 投资助手。
  - title: 组合管理
    details: 实时持仓估值与盈亏追踪，交易记录录入与预警规则设置，所有用户数据持久化在浏览器 IndexedDB 中。
  - title: 零服务端状态
    details: 用户数据全部存储在 IndexedDB（Dexie.js 10 张表），Express 服务端无状态、无用户数据库，部署简单。
  - title: Python 计算引擎
    details: 回测、风险指标、数据补全等计算密集型任务通过 child_process 调度 Python 脚本，JSON stdin/stdout 通信。
---
