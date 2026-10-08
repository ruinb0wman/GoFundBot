import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

vi.mock('../../services/fundService.js', () => ({
  getFundEstimate: vi.fn(async (code: string) => ({
    data: { code, name: null, navDate: null, nav: 1.4, estimatedNav: 1.5, estimatedChangePercent: 5.5, estimateTime: null },
  })),
}));

async function freshDb() {
  const { resetDbForTests, getDb } = await import('../../db/index.js');
  resetDbForTests();
  getDb();
}

describe('alertService', () => {
  beforeEach(freshDb);

  it('persists alert rules and updates/deletes them', async () => {
    const svc = await import('../../services/alertService.js');
    const rule = svc.createAlert({ fund_code: '110022', alert_type: 'price_up', threshold: 3 });
    expect(svc.listAlerts()).toHaveLength(1);
    expect(rule).toMatchObject({ fund_code: '110022', alert_type: 'price_up', threshold: 3, enabled: 1 });

    expect(svc.updateAlert(rule.id, { enabled: 0 })?.enabled).toBe(0);
    expect(svc.updateAlert(rule.id, { threshold: 8 })?.threshold).toBe(8);
    expect(svc.updateAlert(9999, { threshold: 1 })).toBeNull();

    svc.removeAlert(rule.id);
    expect(svc.listAlerts()).toHaveLength(0);
  });

  it('evaluates price rules and applies a cooldown after a hit', async () => {
    const svc = await import('../../services/alertService.js');
    svc.createAlert({ fund_code: '110022', alert_type: 'price_up', threshold: 5 });
    svc.createAlert({ fund_code: '110022', alert_type: 'price_down', threshold: 3 });
    svc.createAlert({ fund_code: '110022', alert_type: 'price_up', threshold: 99 });

    const first = await svc.checkAlerts();
    expect(first.checked_count).toBe(3);
    expect(first.triggered.map((item) => item.alert_type)).toEqual(['price_up']);
    expect(first.triggered[0].value).toBeCloseTo(5.5);

    // 命中后进入冷却，第二次不再重复报
    expect((await svc.checkAlerts()).triggered).toHaveLength(0);
  });

  it('evaluates holding-return rules against settled trades', async () => {
    const svc = await import('../../services/alertService.js');
    const portfolio = await import('../../services/portfolioService.js');
    portfolio.addPortfolioTrade({
      fund_code: '110022',
      type: 'buy',
      trade_date: '2025-01-02',
      amount: 1000,
      share: 1000,
      nav: 1,
      status: 'settled',
    });
    svc.createAlert({ fund_code: '110022', alert_type: 'return_above', threshold: 40 });

    const result = await svc.checkAlerts();
    // 成本 1.0、最新估值 1.5 → 50% > 40%
    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0].value).toBeCloseTo(50);
  });

  it('persists anomaly config with defaults merged', async () => {
    const svc = await import('../../services/alertService.js');
    expect(svc.getAnomalyConfig()).toEqual(svc.DEFAULT_ANOMALY_CONFIG);

    const saved = svc.saveAnomalyConfig({ index_surge_threshold: 4.5 });
    expect(saved.index_surge_threshold).toBe(4.5);
    expect(saved.volume_surge_ratio).toBe(svc.DEFAULT_ANOMALY_CONFIG.volume_surge_ratio);
    expect(svc.getAnomalyConfig().index_surge_threshold).toBe(4.5);
  });
});
