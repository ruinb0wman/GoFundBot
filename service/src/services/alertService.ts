/**
 * 告警规则（`/api/alerts`）—— 真源在 service SQLite（迁移 005），前端 `AlertBadge`/`AlertSettings` 调用。
 *
 * `check()` 是真评估：price_up / price_down 按实时估算涨跌幅；return_above / return_below 按**持仓收益率**
 * （持仓由已结算交易推导，见 `portfolioService.getHoldings`）。命中后 6 小时冷却，避免轮询把同一条规则
 * 反复算成新告警。
 */
import { getDb } from '../db/index.js';
import { getFundEstimate } from './fundService.js';
import { getAVolume7Days, getMarketIndices, getMarketSectorsFromAkshare } from './marketService.js';
import { getHoldings } from './portfolioService.js';

const COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface AlertRule {
  id: number;
  fund_code: string;
  fund_name: string | null;
  alert_type: string;
  threshold: number;
  enabled: number;
  last_triggered: string | null;
  created_time: string;
}

export interface AlertTrigger {
  rule_id: number;
  fund_code: string;
  alert_type: string;
  threshold: number;
  value: number;
  message: string;
}

type Row = Record<string, unknown>;

const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function toRule(row: Row): AlertRule {
  return {
    id: num(row.id),
    fund_code: String(row.fund_code ?? ''),
    fund_name: str(row.fund_name),
    alert_type: String(row.alert_type ?? ''),
    threshold: num(row.threshold),
    enabled: num(row.enabled, 1),
    last_triggered: str(row.last_triggered),
    created_time: String(row.created_time ?? ''),
  };
}

export function listAlerts(): AlertRule[] {
  return getDb()
    .prepare('SELECT * FROM alerts ORDER BY id DESC')
    .all()
    .map((row) => toRule(row as Row));
}

export interface AlertInput {
  fund_code: string;
  alert_type: string;
  threshold: number;
  fund_name?: string | null;
}

export function createAlert(input: AlertInput): AlertRule {
  const info = getDb()
    .prepare(
      `INSERT INTO alerts (fund_code, fund_name, alert_type, threshold, enabled, last_triggered, created_time)
       VALUES (?, ?, ?, ?, 1, NULL, ?)`
    )
    .run(
      String(input.fund_code ?? '').trim(),
      input.fund_name ?? null,
      String(input.alert_type ?? ''),
      num(input.threshold),
      new Date().toISOString()
    );
  const id = Number(info.lastInsertRowid);
  return listAlerts().find((rule) => rule.id === id)!;
}

export function updateAlert(id: number, patch: { threshold?: number; enabled?: number | boolean }): AlertRule | null {
  const current = listAlerts().find((rule) => rule.id === id);
  if (!current) return null;
  getDb()
    .prepare('UPDATE alerts SET threshold = ?, enabled = ? WHERE id = ?')
    .run(
      patch.threshold === undefined ? current.threshold : num(patch.threshold),
      patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0,
      id
    );
  return listAlerts().find((rule) => rule.id === id)!;
}

export function removeAlert(id: number): void {
  getDb().prepare('DELETE FROM alerts WHERE id = ?').run(id);
}

/** 持仓收益率（%）：(市值 − 成本 − 手续费) / 成本。没有持仓就返回 null（该规则跳过）。 */
function holdingReturnPercent(fundCode: string, price: number | null): number | null {
  if (!price) return null;
  const holding = getHoldings()[fundCode];
  if (!holding || !holding.share || !holding.cost) return null;
  const principal = holding.share * holding.cost;
  const profit = holding.share * price - principal - holding.total_fee;
  return (profit / principal) * 100;
}

function evaluate(rule: AlertRule, changePct: number | null, price: number | null): number | null {
  if (rule.alert_type === 'price_up' || rule.alert_type === 'price_down') return changePct;
  if (rule.alert_type === 'return_above' || rule.alert_type === 'return_below') {
    return holdingReturnPercent(rule.fund_code, price);
  }
  return null;
}

function isHit(rule: AlertRule, value: number): boolean {
  switch (rule.alert_type) {
    case 'price_up':
    case 'return_above':
      return value >= rule.threshold;
    case 'price_down':
      return value <= -rule.threshold;
    case 'return_below':
      return value <= rule.threshold;
    default:
      return false;
  }
}

export async function checkAlerts(): Promise<{ triggered: AlertTrigger[]; checked_count: number; rules: AlertRule[] }> {
  const enabled = listAlerts().filter((rule) => rule.enabled);
  const triggered: AlertTrigger[] = [];
  const now = Date.now();

  for (const rule of enabled) {
    const last = rule.last_triggered ? Date.parse(rule.last_triggered) : 0;
    if (Number.isFinite(last) && now - last < COOLDOWN_MS) continue;
    try {
      const estimate = (await getFundEstimate(rule.fund_code)).data;
      const value = evaluate(rule, estimate.estimatedChangePercent, estimate.estimatedNav ?? estimate.nav);
      if (value === null || !Number.isFinite(value) || !isHit(rule, value)) continue;
      getDb().prepare('UPDATE alerts SET last_triggered = ? WHERE id = ?').run(new Date(now).toISOString(), rule.id);
      triggered.push({
        rule_id: rule.id,
        fund_code: rule.fund_code,
        alert_type: rule.alert_type,
        threshold: rule.threshold,
        value: +value.toFixed(2),
        message: `${rule.fund_code} ${rule.alert_type} 命中：当前 ${value.toFixed(2)}% / 阈值 ${rule.threshold}%`,
      });
    } catch {
      // 单只基金取数失败不影响其它规则
    }
  }

  return { triggered, checked_count: enabled.length, rules: listAlerts() };
}

// ── 市场异动（`/api/alerts/anomaly-config` + `/market-anomaly`）─────────────────

/** 异动阈值：与前端 `SettingsAnomalyThreshold.vue` 的表单字段一一对应。 */
export interface AnomalyConfig {
  index_surge_threshold: number;
  index_plunge_threshold: number;
  volume_surge_ratio: number;
  volume_shrink_ratio: number;
  sector_surge_threshold: number;
  sector_plunge_threshold: number;
  sector_inflow_threshold: number;
  north_inflow_threshold: number;
  north_outflow_threshold: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  index_surge_threshold: 3.0,
  index_plunge_threshold: -3.0,
  volume_surge_ratio: 1.5,
  volume_shrink_ratio: 0.5,
  sector_surge_threshold: 5.0,
  sector_plunge_threshold: -5.0,
  sector_inflow_threshold: 10.0,
  north_inflow_threshold: 100.0,
  north_outflow_threshold: -50.0,
};

const ANOMALY_KEY = 'anomaly_config';

/** 与设置页共用 `settings` 表的 key-value（`settingsService` 只管 proxy 子域）。 */
export function getAnomalyConfig(): AnomalyConfig {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(ANOMALY_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...DEFAULT_ANOMALY_CONFIG };
  try {
    const parsed = JSON.parse(row.value) as Partial<AnomalyConfig>;
    const merged = { ...DEFAULT_ANOMALY_CONFIG };
    for (const key of Object.keys(merged) as (keyof AnomalyConfig)[]) {
      const value = Number(parsed[key]);
      if (Number.isFinite(value)) merged[key] = value;
    }
    return merged;
  } catch {
    return { ...DEFAULT_ANOMALY_CONFIG };
  }
}

export function saveAnomalyConfig(patch: Partial<AnomalyConfig>): AnomalyConfig {
  const merged = { ...getAnomalyConfig(), ...patch };
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(ANOMALY_KEY, JSON.stringify(merged), Date.now());
  return merged;
}

export interface MarketAnomaly {
  type: 'index_surge' | 'index_plunge' | 'sector_surge' | 'sector_plunge' | 'volume_surge' | 'volume_shrink';
  name: string;
  value: string;
}

/** 北向净流入已停止披露（恒为 null），所以 `north_*` 阈值暂无数据可判。 */
export async function detectMarketAnomalies(): Promise<{ anomalies: MarketAnomaly[]; data: unknown }> {
  const config = getAnomalyConfig();
  const [indices, sectors, volume] = await Promise.allSettled([
    getMarketIndices(),
    getMarketSectorsFromAkshare(90),
    getAVolume7Days(),
  ]);
  const anomalies: MarketAnomaly[] = [];

  if (indices.status === 'fulfilled') {
    for (const item of indices.value.data.items ?? []) {
      const change = item.changePercent;
      if (change == null) continue;
      if (change >= config.index_surge_threshold) {
        anomalies.push({ type: 'index_surge', name: item.name, value: `+${change.toFixed(2)}%` });
      } else if (change <= config.index_plunge_threshold) {
        anomalies.push({ type: 'index_plunge', name: item.name, value: `${change.toFixed(2)}%` });
      }
    }
  }

  if (sectors.status === 'fulfilled') {
    for (const item of sectors.value.items ?? []) {
      const change = item.raw_change;
      if (change == null) continue;
      if (change >= config.sector_surge_threshold) {
        anomalies.push({ type: 'sector_surge', name: item.name, value: `+${change.toFixed(2)}%` });
      } else if (change <= config.sector_plunge_threshold) {
        anomalies.push({ type: 'sector_plunge', name: item.name, value: `${change.toFixed(2)}%` });
      }
    }
  }

  if (volume.status === 'fulfilled' && volume.value.data.length >= 3) {
    const rows = volume.value.data;
    const latest = Number(rows[rows.length - 1]?.total);
    const history = rows.slice(0, -1).map((row) => Number(row.total)).filter((n) => Number.isFinite(n) && n > 0);
    const average = history.length ? history.reduce((sum, n) => sum + n, 0) / history.length : 0;
    if (Number.isFinite(latest) && average > 0) {
      const ratio = latest / average;
      if (ratio >= config.volume_surge_ratio) {
        anomalies.push({ type: 'volume_surge', name: '两市成交额', value: `${ratio.toFixed(2)}x` });
      } else if (ratio <= config.volume_shrink_ratio) {
        anomalies.push({ type: 'volume_shrink', name: '两市成交额', value: `${ratio.toFixed(2)}x` });
      }
    }
  }

  const data = indices.status === 'fulfilled' ? indices.value.data : { items: [] };
  return { anomalies, data };
}
