import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import FundDetailView from '../views/FundDetailView.vue'
import ScreeningView from '../views/ScreeningView.vue'
import BacktestView from '../views/BacktestView.vue'
import PortfolioView from '../views/PortfolioView.vue'
import ResearchView from '../views/ResearchView.vue'

const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: DashboardView,
    meta: { rightbar: true }
  },
  {
    path: '/fund/:code',
    name: 'fund-detail',
    component: FundDetailView,
    meta: { rightbar: true }
  },
  {
    path: '/screening',
    name: 'screening',
    component: ScreeningView,
    meta: { rightbar: false }
  },
  {
    path: '/backtest',
    name: 'backtest',
    component: BacktestView,
    meta: { rightbar: false }
  },
  {
    path: '/backtest/:code',
    name: 'backtest-fund',
    component: BacktestView,
    meta: { rightbar: false }
  },
  {
    path: '/portfolio',
    name: 'portfolio',
    component: PortfolioView,
    meta: { rightbar: false }
  },
  {
    path: '/research',
    name: 'research',
    component: ResearchView,
    meta: { rightbar: false }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

export default router
