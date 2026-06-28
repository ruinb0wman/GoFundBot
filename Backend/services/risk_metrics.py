import math
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import desc

from core.logging import get_logger
from models import FundRiskMetrics
from services.helpers import _to_float, _json_loads

logger = get_logger(__name__)


def calculate_risk_metrics(net_worth_trend):
    if not net_worth_trend or len(net_worth_trend) < 30:
        return None

    sorted_data = sorted(net_worth_trend, key=lambda x: x.get('date', ''))
    dates = []
    values = []
    for item in sorted_data:
        if item.get('net_worth') is not None:
            dates.append(item.get('date'))
            values.append(float(item.get('net_worth')))

    if len(values) >= 2:
        v0 = values[0]
        v1 = values[1]
        if v0 > 0 and abs((v1 - v0) / v0) > 0.5:
            values.pop(0)
            dates.pop(0)

    if len(values) < 30:
        return None

    now = datetime.now()

    def get_period_data(months):
        if months == 'all':
            return values, dates
        cutoff_date = (now - timedelta(days=months * 30)).strftime('%Y-%m-%d')
        period_values = []
        period_dates = []
        for i, d in enumerate(dates):
            if d >= cutoff_date:
                period_values.append(values[i])
                period_dates.append(d)
        return period_values, period_dates

    def calc_max_drawdown(period_values):
        if len(period_values) < 2:
            return None
        peak = period_values[0]
        max_dd = 0
        for value in period_values:
            if value > peak:
                peak = value
            drawdown = (peak - value) / peak * 100
            if drawdown > max_dd:
                max_dd = drawdown
        return round(max_dd, 2)

    def calc_daily_returns(period_values):
        if len(period_values) < 2:
            return []
        returns = []
        for i in range(1, len(period_values)):
            if period_values[i - 1] != 0:
                ret = (period_values[i] - period_values[i - 1]) / period_values[i - 1]
                returns.append(ret)
        return returns

    def calc_annual_return(period_values, trading_days):
        if len(period_values) < 2 or period_values[0] == 0:
            return None
        total_return = (period_values[-1] - period_values[0]) / period_values[0]
        if trading_days <= 0:
            return None
        annual_return = ((1 + total_return) ** (252 / trading_days) - 1) * 100
        return round(annual_return, 2)

    def calc_volatility(daily_returns):
        if len(daily_returns) < 10:
            return None
        mean_return = sum(daily_returns) / len(daily_returns)
        variance = sum((r - mean_return) ** 2 for r in daily_returns) / len(daily_returns)
        daily_vol = math.sqrt(variance)
        annual_vol = daily_vol * math.sqrt(252) * 100
        return round(annual_vol, 2)

    def calc_sharpe_ratio(annual_return, volatility, risk_free_rate=2.0):
        if volatility is None or volatility == 0 or annual_return is None:
            return None
        sharpe = (annual_return - risk_free_rate) / volatility
        return round(sharpe, 2)

    result = {}

    for period, months in [('3m', 3), ('6m', 6), ('1y', 12), ('3y', 36), ('all', 'all')]:
        period_values, _ = get_period_data(months)
        result[f'max_drawdown_{period}'] = calc_max_drawdown(period_values)

    min_trading_days = {'1y': 200, '3y': 600}

    for period, months in [('1y', 12), ('3y', 36)]:
        period_values, period_dates = get_period_data(months)
        trading_days = len(period_values)
        min_days = min_trading_days.get(period, 30)
        if trading_days < min_days:
            result[f'annual_return_{period}'] = None
            result[f'volatility_{period}'] = None
            result[f'sharpe_ratio_{period}'] = None
            result[f'calmar_ratio_{period}'] = None
            continue

        daily_returns = calc_daily_returns(period_values)
        annual_return = calc_annual_return(period_values, trading_days)
        volatility = calc_volatility(daily_returns)
        sharpe = calc_sharpe_ratio(annual_return, volatility)

        if volatility is not None and volatility > 500:
            result[f'annual_return_{period}'] = None
            result[f'volatility_{period}'] = None
            result[f'sharpe_ratio_{period}'] = None
            result[f'calmar_ratio_{period}'] = None
            continue

        result[f'annual_return_{period}'] = annual_return
        result[f'volatility_{period}'] = volatility
        result[f'sharpe_ratio_{period}'] = sharpe

        max_dd = result.get(f'max_drawdown_{period}')
        if annual_return is not None and max_dd is not None and max_dd > 0:
            result[f'calmar_ratio_{period}'] = round(annual_return / max_dd, 2)
        else:
            result[f'calmar_ratio_{period}'] = None

    return result


def _save_risk_metrics(db: Session, fund_code: str, risk_metrics: dict):
    if not risk_metrics:
        return

    risk_record = db.query(FundRiskMetrics).filter(FundRiskMetrics.fund_code == fund_code).first()
    if risk_record:
        for key, value in risk_metrics.items():
            if hasattr(risk_record, key):
                setattr(risk_record, key, value)
        risk_record.updated_time = datetime.now()
    else:
        risk_record = FundRiskMetrics(
            fund_code=fund_code,
            **{k: v for k, v in risk_metrics.items() if hasattr(FundRiskMetrics, k)}
        )
        db.add(risk_record)


def calculate_calmar_ratio(annual_return, max_drawdown):
    if max_drawdown is None or max_drawdown == 0 or annual_return is None:
        return None
    return round(annual_return / max_drawdown, 2)


def _nav_history_to_risk_input(payload):
    data = payload.get('data', {}) if isinstance(payload, dict) else {}
    items = data.get('items', []) if isinstance(data, dict) else []
    trend = []
    for item in items:
        if not isinstance(item, dict):
            continue
        nav = item.get('nav')
        date = item.get('date')
        if nav is not None and date:
            trend.append({'date': str(date), 'net_worth': nav})
    return trend


def _nav_history_payload_items(payload):
    data = payload.get('data', {}) if isinstance(payload, dict) else {}
    items = data.get('items', []) if isinstance(data, dict) else []
    return items if isinstance(items, list) else []


def _latest_cached_nav_date(db, fund_code):
    from models import FundNavHistory
    row = db.query(FundNavHistory.trade_date).filter(
        FundNavHistory.fund_code == fund_code
    ).order_by(desc(FundNavHistory.trade_date)).first()
    return row[0] if row else None


def _load_nav_history_rows(db, fund_code):
    from models import FundNavHistory
    rows = db.query(FundNavHistory).filter(
        FundNavHistory.fund_code == fund_code,
        FundNavHistory.nav.isnot(None),
    ).order_by(FundNavHistory.trade_date.asc()).all()
    return [{'date': row.trade_date, 'net_worth': row.nav} for row in rows]


def _upsert_nav_history_rows(db, fund_code, payload):
    return len(_nav_history_payload_items(payload))


def _snapshot_nav_date(db, fund_code):
    from models import FundBasicInfo
    basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
    if not basic:
        return None
    basic_info = _json_loads(basic.basic_json, {})
    return basic_info.get('net_worth_date') or basic_info.get('navDate')


def _nav_cache_is_fresh(db, fund_code):
    latest_cached = _latest_cached_nav_date(db, fund_code)
    latest_snapshot = _snapshot_nav_date(db, fund_code)
    if not latest_cached:
        return False
    if latest_snapshot and latest_cached < str(latest_snapshot):
        return False
    return True


def _sync_nav_history_ifund_style(db, fund_code, force=False):
    from services.helpers import _normalize_fund_code
    fund_code = _normalize_fund_code(fund_code)
    if not fund_code:
        return 0
    if not force and _nav_cache_is_fresh(db, fund_code):
        return 0
    latest_cached = _latest_cached_nav_date(db, fund_code)
    if force:
        start_date = None
    elif latest_cached:
        try:
            start_date = (datetime.strptime(latest_cached, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
        except ValueError:
            start_date = None
    else:
        start_date = None
    from services.data_service_client import get_data_service_client
    payload = get_data_service_client().get_fund_nav_history(fund_code, start_date=start_date)
    inserted = _upsert_nav_history_rows(db, fund_code, payload)
    db.commit()
    return inserted
