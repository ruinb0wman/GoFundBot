import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import FundDetailView from '../views/FundDetailView.vue'
import IndexDetailView from '../views/IndexDetailView.vue'
import ScreeningView from '../views/ScreeningView.vue'
import BacktestView from '../views/BacktestView.vue'
import PortfolioView from '../views/PortfolioView.vue'
import ResearchView from '../views/ResearchView.vue'
import SettingsView from '../views/SettingsView.vue'
import SettingsGeneral from '../views/SettingsGeneral.vue'
import SettingsLLM from '../views/SettingsLLM.vue'
import LogsViewer from '../views/LogsViewer.vue'
import SettingsProxy from '../views/SettingsProxy.vue'
import SettingsSearch from '../views/SettingsSearch.vue'
import SettingsSqliteAdmin from '../views/SettingsSqliteAdmin.vue'
import SettingsAnomalyThreshold from '../views/SettingsAnomalyThreshold.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'dashboard',
    component: DashboardView,
    meta: { rightbar: true },
  },
  {
    path: '/fund/:code',
    name: 'fund-detail',
    component: FundDetailView,
    meta: { rightbar: true },
  },
  {
    path: '/index/:code',
    name: 'index-detail',
    component: IndexDetailView,
    meta: { rightbar: true },
  },
  {
    path: '/screening',
    name: 'screening',
    component: ScreeningView,
    meta: { rightbar: false },
  },
  {
    path: '/backtest',
    name: 'backtest',
    component: BacktestView,
    meta: { rightbar: false },
  },
  {
    path: '/backtest/:code',
    name: 'backtest-fund',
    component: BacktestView,
    meta: { rightbar: false },
  },
  {
    path: '/portfolio',
    name: 'portfolio',
    component: PortfolioView,
    meta: { rightbar: false },
  },
  {
    path: '/research',
    name: 'research',
    component: ResearchView,
    meta: { rightbar: false },
  },
  {
    path: '/logs',
    redirect: '/settings/logs',
  },
  {
    path: '/settings',
    component: SettingsView,
    meta: { rightbar: false },
      children: [
        { path: '', redirect: { name: 'settings-general' } },
        { path: 'general', name: 'settings-general', component: SettingsGeneral },
        { path: 'llm', name: 'settings-llm', component: SettingsLLM },
        { path: 'proxy', name: 'settings-proxy', component: SettingsProxy },
        { path: 'search', name: 'settings-search', component: SettingsSearch },
        { path: 'logs', name: 'settings-logs', component: LogsViewer },
        { path: 'anomaly', name: 'settings-anomaly', component: SettingsAnomalyThreshold },
        { path: 'sqlite-admin', name: 'settings-sqlite-admin', component: SettingsSqliteAdmin },
      ],
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

export default router
