"""Strategy recommendation engine for fixed-investment plans.

Runs multiple backtest scenarios and returns the best strategy."""

import math
from datetime import datetime

from core.logging import get_logger

logger = get_logger(__name__)


def _moving_average(data: list[float], period: int) -> list[float | None]:
    """Calculate simple moving average."""
    result: list[float | None] = []
    for i in range(len(data)):
        if i < period - 1:
            result.append(None)
        else:
            result.append(sum(data[i - period + 1 : i + 1]) / period)
    return result


def _calc_summary(timeline: list[dict], final_record: dict) -> dict:
    """Calculate summary metrics from a backtest timeline (same logic as _run_backtest)."""
    max_drawdown = 0.0
    peak_value = 0.0
    for record in timeline:
        value = record["value"]
        if value > peak_value:
            peak_value = value
        if peak_value > 0:
            drawdown = (peak_value - value) / peak_value * 100
            if drawdown > max_drawdown:
                max_drawdown = drawdown

    start_date = datetime.strptime(timeline[0]["date"], "%Y-%m-%d")
    end_date = datetime.strptime(timeline[-1]["date"], "%Y-%m-%d")
    days = (end_date - start_date).days
    years = days / 365.25

    total_return_rate = final_record["return_rate"] / 100
    annual_return = 0.0
    if years > 0 and total_return_rate > -1:
        annual_return = (pow(1 + total_return_rate, 1 / years) - 1) * 100

    returns = []
    for i in range(1, len(timeline)):
        if timeline[i - 1]["value"] > 0:
            daily_return = (timeline[i]["value"] - timeline[i - 1]["value"]) / timeline[i - 1]["value"]
            returns.append(daily_return)

    sharpe_ratio = 0.0
    if len(returns) > 0:
        mean_return = sum(returns) / len(returns)
        if len(returns) > 1:
            variance = sum((r - mean_return) ** 2 for r in returns) / (len(returns) - 1)
            std_dev = math.sqrt(variance)
            if std_dev > 0:
                risk_free_rate = 0.02 / 252
                sharpe_ratio = (mean_return - risk_free_rate) / std_dev * math.sqrt(252)

    return {
        "total_invested": round(final_record["invested"], 2),
        "final_value": round(final_record["value"], 2),
        "total_return": round(final_record["return"], 2),
        "return_rate": round(final_record["return_rate"], 2),
        "annual_return": round(annual_return, 2),
        "max_drawdown": round(-max_drawdown, 2),
        "sharpe_ratio": round(sharpe_ratio, 2),
        "days": days,
    }


def _run_ma_strategy(nav_dict: dict, dates: list, fee_rate: float, ma_period: int = 60) -> dict:
    """Moving-average strategy: invest on dates when NAV < MA, skip when above."""
    sorted_dates = sorted(dates)
    navs = [nav_dict[d] for d in sorted_dates]
    mas = _moving_average(navs, ma_period)

    total_invested = 0.0
    total_shares = 0.0
    timeline = []

    for i, date in enumerate(sorted_dates):
        nav = nav_dict[date]
        ma = mas[i]

        # Initial investment on first day
        if i == 0:
            actual = 1000 * (1 - fee_rate)
            shares = actual / nav
            total_shares += shares
            total_invested += 1000
            is_invest_day = True
        elif ma is not None and nav < ma:
            # Below MA — invest
            amount = 1000
            actual = amount * (1 - fee_rate)
            shares = actual / nav
            total_shares += shares
            total_invested += amount
            is_invest_day = True
        else:
            is_invest_day = False

        current_value = total_shares * nav
        total_return = current_value - total_invested
        return_rate = (total_return / total_invested * 100) if total_invested > 0 else 0.0

        timeline.append(
            {
                "date": date,
                "invested": round(total_invested, 2),
                "shares": round(total_shares, 4),
                "nav": round(nav, 4),
                "value": round(current_value, 2),
                "return": round(total_return, 2),
                "return_rate": round(return_rate, 2),
                "is_investment_day": is_invest_day,
                "status": "holding",
            }
        )

    if not timeline:
        return {"error": "No data"}

    final_record = timeline[-1]
    summary = _calc_summary(timeline, final_record)
    return {"summary": summary, "timeline": timeline}


def _run_value_averaging(nav_dict: dict, dates: list, fee_rate: float, target_growth: float = 0.01) -> dict:
    """Value-averaging strategy: invest enough each period to reach a target portfolio value."""
    sorted_dates = sorted(dates)
    total_invested = 0.0
    total_shares = 0.0
    target_portfolio = 0.0
    timeline = []

    for i, date in enumerate(sorted_dates):
        nav = nav_dict[date]
        target_portfolio += 1000  # 1000 per period
        if i > 0:
            target_portfolio *= 1 + target_growth

        current_value = total_shares * nav
        required = target_portfolio - current_value

        is_invest_day = False
        if required > 0:
            amount = min(required, 10000)  # cap at 10k per period
            actual = amount * (1 - fee_rate)
            shares = actual / nav
            total_shares += shares
            total_invested += amount
            is_invest_day = True
        elif required < -1000:
            # Withdraw excess (simplified: sell)
            sell_amount = min(abs(required), current_value * 0.3)
            shares_to_sell = sell_amount / nav
            total_shares -= shares_to_sell
            total_invested -= sell_amount * (1 - fee_rate)
            is_invest_day = False

        current_value = total_shares * nav
        total_return = current_value - total_invested
        return_rate = (total_return / total_invested * 100) if total_invested > 0 else 0.0

        timeline.append(
            {
                "date": date,
                "invested": round(total_invested, 2),
                "shares": round(total_shares, 4),
                "nav": round(nav, 4),
                "value": round(current_value, 2),
                "return": round(total_return, 2),
                "return_rate": round(return_rate, 2),
                "is_investment_day": is_invest_day,
                "status": "holding",
            }
        )

    if not timeline:
        return {"error": "No data"}

    final_record = timeline[-1]
    summary = _calc_summary(timeline, final_record)
    return {"summary": summary, "timeline": timeline}


def suggest_optimal_plan(nav_dict: dict, dates: list, fee_rate: float = 0.0015) -> dict:
    """Run all strategies and recommend the best one.

    Returns:
        {
            "recommended": { "name": ..., "description": ..., "summary": ... },
            "strategies": [ { "name": ..., "summary": ... }, ... ]
        }
    """
    from services.backtest import _run_backtest

    results = []

    # 1. Monthly (baseline)
    monthly = _run_backtest(nav_dict, dates, "monthly", 1000, 0, fee_rate)
    if "summary" in monthly:
        monthly["summary"]["strategy"] = "monthly"
        results.append(
            {
                "name": "月定投（基准）",
                "key": "monthly",
                "description": "每月固定1000元定投",
                "summary": monthly["summary"],
            }
        )

    # 2. Weekly
    weekly = _run_backtest(nav_dict, dates, "weekly", 250, 0, fee_rate)
    if "summary" in weekly:
        weekly["summary"]["strategy"] = "weekly"
        results.append(
            {"name": "周定投", "key": "weekly", "description": "每周固定250元定投", "summary": weekly["summary"]}
        )

    # 3. Moving Average strategy
    for period in [20, 60, 120]:
        ma = _run_ma_strategy(nav_dict, dates, fee_rate, ma_period=period)
        if "summary" in ma:
            ma["summary"]["strategy"] = f"ma_{period}"
            results.append(
                {
                    "name": f"均线策略 (MA{period})",
                    "key": f"ma_{period}",
                    "description": f"净值低于{period}日均线时买入，高于时暂停",
                    "summary": ma["summary"],
                }
            )

    # 4. Value averaging
    va = _run_value_averaging(nav_dict, dates, fee_rate)
    if "summary" in va:
        va["summary"]["strategy"] = "value_averaging"
        results.append(
            {
                "name": "价值平均策略",
                "key": "value_averaging",
                "description": "每期使组合价值达到目标值",
                "summary": va["summary"],
            }
        )

    if not results:
        return {"error": "无法生成策略推荐"}

    # Score each strategy (higher is better)
    scored = []
    for r in results:
        s = r["summary"]
        score = s.get("return_rate", 0) * 0.5 - abs(s.get("max_drawdown", 0)) * 0.2 + s.get("sharpe_ratio", 0) * 0.3
        scored.append((score, r))

    scored.sort(key=lambda x: x[0], reverse=True)
    best = scored[0][1]
    best_name = best["name"]
    best_summary = best["summary"]

    recommendation = {
        "name": best_name,
        "key": best["key"],
        "description": best["description"],
        "reason": f"综合评分最高，预期年化 {best_summary.get('annual_return', 0):.1f}%，"
        f"最大回撤 {best_summary.get('max_drawdown', 0):.1f}%，"
        f"夏普比率 {best_summary.get('sharpe_ratio', 2):.2f}",
        "summary": best_summary,
    }

    return {
        "recommended": recommendation,
        "strategies": [
            {"name": r["name"], "key": r["key"], "description": r["description"], "summary": r["summary"]}
            for _, r in scored
        ],
    }
