import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'GoFundBot Docs',
  description: 'GoFundBot 项目文档',
  base: '/docs',
  themeConfig: {
    sidebar: [
      {
        text: '市场数据',
        items: [
          { text: '今日资金流向', link: '/market-money-flow' },
          { text: '实时贵金属', link: '/market-gold' },
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
