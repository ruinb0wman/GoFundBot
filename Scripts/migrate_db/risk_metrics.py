import json
import math
import os
import sqlite3
from datetime import datetime, timedelta

from migrate_db.core import DB_PATH


def _calculate_risk_metrics(net_worth_trend):
    if not net_worth_trend or len(net_worth_trend) < 30:
        return None

    sorted_data = sorted(net_worth_trend, key=lambda x: x.get("date", ""))

    dates = []
    values = []
    for item in sorted_data:
        if item.get("net_worth") is not None:
            dates.append(item.get("date"))
            values.append(float(item.get("net_worth")))

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
        if months == "all":
            return values, dates
        cutoff_date = (now - timedelta(days=months * 30)).strftime("%Y-%m-%d")
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
        if len(period_values) < 2 or period_values[0] == 0 or trading_days <= 0:
            return None
        total_return = (period_values[-1] - period_values[0]) / period_values[0]
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

    for period, months in [("3m", 3), ("6m", 6), ("1y", 12), ("3y", 36), ("all", "all")]:
        period_values, _ = get_period_data(months)
        result[f"max_drawdown_{period}"] = calc_max_drawdown(period_values)

    min_trading_days = {"1y": 200, "3y": 600}

    for period, months in [("1y", 12), ("3y", 36)]:
        period_values, period_dates = get_period_data(months)
        trading_days = len(period_values)

        min_days = min_trading_days.get(period, 30)
        if trading_days < min_days:
            result[f"annual_return_{period}"] = None
            result[f"volatility_{period}"] = None
            result[f"sharpe_ratio_{period}"] = None
            result[f"calmar_ratio_{period}"] = None
            continue

        daily_returns = calc_daily_returns(period_values)
        annual_return = calc_annual_return(period_values, trading_days)
        volatility = calc_volatility(daily_returns)
        sharpe = calc_sharpe_ratio(annual_return, volatility)

        if volatility is not None and volatility > 500:
            result[f"annual_return_{period}"] = None
            result[f"volatility_{period}"] = None
            result[f"sharpe_ratio_{period}"] = None
            result[f"calmar_ratio_{period}"] = None
            continue

        result[f"annual_return_{period}"] = annual_return
        result[f"volatility_{period}"] = volatility
        result[f"sharpe_ratio_{period}"] = sharpe

        max_dd = result.get(f"max_drawdown_{period}")
        if annual_return is not None and max_dd is not None and max_dd > 0:
            result[f"calmar_ratio_{period}"] = round(annual_return / max_dd, 2)
        else:
            result[f"calmar_ratio_{period}"] = None

    return result


def recalculate_all_risk_metrics():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        print("=" * 60)
        print("\u5f00\u59cb\u91cd\u65b0\u8ba1\u7b97\u98ce\u9669\u6307\u6807...")
        print("=" * 60)

        cursor.execute("""
            SELECT fund_code, net_worth_trend_json
            FROM fund_trend
            WHERE net_worth_trend_json IS NOT NULL
        """)
        funds = cursor.fetchall()

        print(f"\u5171\u6709 {len(funds)} \u53ea\u57fa\u91d1\u9700\u8981\u8ba1\u7b97")

        success_count = 0
        skip_count = 0

        for i, (fund_code, trend_json) in enumerate(funds, 1):
            if i % 100 == 0:
                print(f"\u8fdb\u5ea6: {i}/{len(funds)} ({i * 100 // len(funds)}%)")

            try:
                net_worth_trend = json.loads(trend_json) if trend_json else []
                if not net_worth_trend or len(net_worth_trend) < 30:
                    skip_count += 1
                    continue

                risk_metrics = _calculate_risk_metrics(net_worth_trend)
                if not risk_metrics:
                    skip_count += 1
                    continue

                cursor.execute(
                    """
                    INSERT OR REPLACE INTO fund_risk_metrics
                    (fund_code, max_drawdown_3m, max_drawdown_6m, max_drawdown_1y, max_drawdown_3y, max_drawdown_all,
                     sharpe_ratio_1y, sharpe_ratio_3y, volatility_1y, volatility_3y,
                     annual_return_1y, annual_return_3y, calmar_ratio_1y, calmar_ratio_3y, updated_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        fund_code,
                        risk_metrics.get("max_drawdown_3m"),
                        risk_metrics.get("max_drawdown_6m"),
                        risk_metrics.get("max_drawdown_1y"),
                        risk_metrics.get("max_drawdown_3y"),
                        risk_metrics.get("max_drawdown_all"),
                        risk_metrics.get("sharpe_ratio_1y"),
                        risk_metrics.get("sharpe_ratio_3y"),
                        risk_metrics.get("volatility_1y"),
                        risk_metrics.get("volatility_3y"),
                        risk_metrics.get("annual_return_1y"),
                        risk_metrics.get("annual_return_3y"),
                        risk_metrics.get("calmar_ratio_1y"),
                        risk_metrics.get("calmar_ratio_3y"),
                        datetime.now().isoformat(),
                    ),
                )
                success_count += 1

            except Exception as e:
                print(f"Error processing {fund_code}: {e}")
                skip_count += 1

        conn.commit()
        print("=" * 60)
        print(
            f"\u98ce\u9669\u6307\u6807\u8ba1\u7b97\u5b8c\u6210\uff01\u6210\u529f: {success_count}, \u8df3\u8fc7: {skip_count}"
        )

    except Exception as e:
        print(f"Error during recalculation: {str(e)}")
        conn.rollback()
    finally:
        conn.close()
