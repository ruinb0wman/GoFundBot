import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'GoFundBot',
  description: '智能基金分析与研究平台 — AI 驱动、全栈开源',
  base: '/docs',
  themeConfig: {
    nav: [
      { text: '首页', link: '/index' },
      { text: '技术架构总览', link: '/architecture/' },
    ],
    sidebar: [
      {
        text: '市场数据',
        items: [
          { text: '市场指数近一月走势', link: '/market-index-trend' },
          { text: '全球行情', link: '/market-global' },
          { text: '近7日A股成交量', link: '/market-volume' },
          { text: '今日资金流向', link: '/market-money-flow' },
          { text: '实时贵金属', link: '/market-gold' },
          { text: '7×24 快讯', link: '/market-news' },
          { text: '行业板块排行', link: '/market-sector-rank' },
          { text: '我的自选', link: '/market-watchlist' },
        ],
      },
      {
        text: '架构',
        items: [
          { text: '技术架构总览', link: '/architecture/' },
          { text: '数据源', link: '/architecture/data-sources' },
          { text: '数据流向', link: '/architecture/data-flow' },
          { text: '数据回退策略', link: '/architecture/fallback-strategy' },
          { text: '模块数据源映射', link: '/architecture/module-data-sources' },
          { text: '基金数据合并策略', link: '/architecture/fund-data-merge' },
          { text: 'AI 分析框架总览', link: '/architecture/ai-overview' },
          { text: 'AI 对话系统', link: '/architecture/ai-chat' },
          { text: 'AI 基金分析与持仓分析', link: '/architecture/ai-fund-analysis' },
          { text: '记忆与反思系统', link: '/architecture/ai-memory' },
        ],
      },
      {
        text: '数据来源',
        items: [
          { text: '数据来源与运行时总览', link: '/data-sources-and-runtime' },
          { text: 'Tushare 接入', link: '/tushare' },
        ],
      },
    ],
  },
})
