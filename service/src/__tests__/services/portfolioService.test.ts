import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

async function freshDb() {
  const { resetDbForTests, getDb } = await import('../../db/index.js');
  resetDbForTests();
  getDb();
}

describe('portfolioService', () => {
  beforeEach(freshDb);

  it('keeps portfolio funds in order and removes them with their group mapping', async () => {
    const svc = await import('../../services/portfolioService.js');
    svc.addPortfolioFund({ fund_code: '110022', fund_name: '易方达消费', fund_type: '混合型' });
    svc.addPortfolioFunds([{ fund_code: '161725', fund_name: null, fund_type: null }]);

    expect(svc.listPortfolioFunds().map((fund) => fund.fund_code)).toEqual(['110022', '161725']);
    svc.reorderPortfolioFunds(['161725', '110022']);
    expect(svc.listPortfolioFunds().map((fund) => fund.fund_code)).toEqual(['161725', '110022']);

    const group = svc.createPortfolioGroup({ name: '核心' });
    svc.syncPortfolioGroupMap([{ fund_code: '110022', group_id: group.id }]);
    expect(svc.getPortfolioGroupMap()).toEqual({ '110022': group.id });

    svc.removePortfolioFund('110022');
    expect(svc.listPortfolioFunds().map((fund) => fund.fund_code)).toEqual(['161725']);
    expect(svc.getPortfolioGroupMap()).toEqual({});
  });

  it('cascades group deletion to fund mappings', async () => {
    const svc = await import('../../services/portfolioService.js');
    const group = svc.createPortfolioGroup({ name: '卫星' });
    svc.addPortfolioFund({ fund_code: '110022', fund_name: null, fund_type: null });
    svc.syncPortfolioGroupMap([{ fund_code: '110022', group_id: group.id }]);

    svc.deletePortfolioGroup(group.id);
    expect(svc.listPortfolioGroups()).toHaveLength(0);
    expect(svc.getPortfolioGroupMap()).toEqual({});
  });

  it('derives holdings from settled trades only (buy/sell/dividend/fee)', async () => {
    const svc = await import('../../services/portfolioService.js');
    const trade = (type: string, fields: Record<string, number | string>) => ({
      fund_code: '110022',
      type,
      trade_date: '2025-01-02',
      amount: 0,
      share: 0,
      nav: 0,
      status: 'settled',
      ...fields,
    });

    svc.addPortfolioTrade(trade('buy', { amount: 1000, share: 100, nav: 10 }));
    // pending 不计入持仓
    svc.addPortfolioTrade({ ...trade('buy', { amount: 1000, share: 100, nav: 10 }), status: 'pending' });
    svc.addPortfolioTrade(trade('dividend', { amount: 100, share: 5, nav: 20 }));
    svc.addPortfolioTrade(trade('fee', { amount: 2 }));

    const holding = svc.getHoldings()['110022'];
    expect(holding.share).toBeCloseTo(105);
    expect(holding.cost).toBeCloseTo(10);
    expect(holding.total_fee).toBeCloseTo(2);

    // 卖出到清零 → 整只消失
    svc.addPortfolioTrade(trade('sell', { amount: 1050, share: 105, nav: 10 }));
    expect(svc.getHoldings()['110022']).toBeUndefined();
  });

  it('settles pending trades by txn_id and can delete them', async () => {
    const svc = await import('../../services/portfolioService.js');
    const created = svc.addPortfolioTrade({
      fund_code: '110022',
      type: 'buy',
      trade_date: '2025-01-02',
      amount: 1000,
      share: 100,
      nav: 10,
      status: 'pending',
      txn_id: 'txn-1',
    });
    expect(svc.getHoldings()['110022']).toBeUndefined();

    svc.settlePortfolioTrades(['txn-1']);
    expect(svc.listPortfolioTrades()[0].status).toBe('settled');
    expect(svc.getHoldings()['110022'].share).toBeCloseTo(100);

    svc.deletePortfolioTradeByTxn('txn-1');
    expect(svc.listPortfolioTrades().find((row) => row.id === created.id)).toBeUndefined();
  });

  it('restores funds / groups / mappings / holdings from an exported payload', async () => {
    const svc = await import('../../services/portfolioService.js');
    const summary = svc.migratePortfolio({
      funds: [{ code: '110022', name: '易方达消费', type: '混合型' }],
      fundOrder: ['110022'],
      portfolioGroups: [{ id: 'g_1', name: '核心', rebalance_enabled: 1 }],
      fundGroupMap: { '110022': 'g_1' },
      holdings: { '110022': { share: 12, cost: 9.5, total_fee: 1 } },
    });

    expect(summary.restored).toMatchObject({ funds: 1, groups: 1, mappings: 1, holdings: 1 });
    const group = svc.listPortfolioGroups()[0];
    expect(svc.getPortfolioGroupMap()).toEqual({ '110022': group.id });
    expect(svc.getHoldings()['110022']).toMatchObject({ share: 12, cost: 9.5, total_fee: 1 });
  });
});
