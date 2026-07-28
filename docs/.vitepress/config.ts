import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'GoFundBot',
  description: '智能基金分析与研究平台 — AI 驱动、全栈开源',
  base: '/docs',
  themeConfig: {
    nav: [
      { text: '首页', link: '/index' },
      { text: '数据来源与运行时总览', link: '/data-sources-and-runtime' },
      { text: 'Tushare 接入', link: '/tushare' },
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
        text: '数据来源',
        items: [
          { text: '数据来源与运行时总览', link: '/data-sources-and-runtime' },
          { text: 'Tushare 接入', link: '/tushare' },
        ],
      },
    ],
  },
})
