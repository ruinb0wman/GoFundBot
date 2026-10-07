---
layout: home

hero:
  name: GoFundBot
  text: 智能基金分析与研究平台
  tagline: 终端 pi 驱动的研究助手 · 实时市场数据 · 量化筛选 · 共享回测内核
  actions:
    - theme: brand
      text: 开始阅读
      link: /data-sources-and-runtime
    - theme: alt
      text: GitHub
      link: https://github.com/ruinb0w/GoFundBot

features:
  - title: 终端 pi 是唯一 AI
    details: 应用本身不持有任何 LLM 密钥；AI 交互由终端 pi 承担 —— 工具清单由 service 的 GET /api/agent/tools 给出（行情/基金/回测/筛选/策略，共 27 个），写入与执行类操作要用户确认令牌。
  - title: 实时市场数据
    details: ProviderChain 多源自动降级（stock-sdk → EastMoney → Tencent → Yahoo），覆盖基金净值、K 线、指数、板块、贵金属实时行情与资金流向。
  - title: 基金筛选
    details: 4433 法则、夏普比率、低波动率等预置策略 + 自定义条件筛选，结合风险指标（最大回撤、Calmar 比）和行业标签。
  - title: 回测工作台
    details: 单基金 / 多资产组合统一在一个代码优先的工作台：写或让 AI 写策略代码，保存为可重放方案，浏览器内 Worker 沙箱计算并可视化收益与风险。
  - title: 共享计算内核
    details: 回测/组合引擎、风险指标、行业分类、4433 排名都在 packages/core 里，前端页面与 service 路由共用同一份源码，同一组参数必然同值（黄金 fixtures 双侧逐值校验）。
  - title: 用户数据落 SQLite
    details: 自选/持仓/策略/回测方案的唯一真源是 service 的 SQLite（本机 127.0.0.1），前端只做展示 —— 换浏览器看到的是同一份数据。
  - title: 代码优先回测
    details: 写（或让 pi 写）一段策略代码：prepare(sdk) 声明固定池、onDay(s) 按基金代码逐日决策；服务端在 node:worker_threads 沙箱里跑（5s 超时终止），页面也有等价的浏览器 Worker 通道。
  - title: Python 只做补数
    details: 数据补全（akshare/eastmoney）由 Python 脚本承担，通过 child_process 调用、stdin/stdout 传 JSON；计算密集型逻辑都在 packages/core（TS）。
---
