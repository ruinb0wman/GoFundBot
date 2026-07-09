#!/usr/bin/env python3
"""
Backtest script — runs fixed-investment simulations.

stdin: {
  "fundCode": "019667",
  "navHistory": [{"date": "2025-01-01", "nav": 1.0}, ...],
  "investmentType": "monthly",
  "amount": 1000,
  "initialAmount": 0,
  "feeRate": 0.0015,
  "takeProfitRate": null,
  "stopLossRate": null
}
stdout: {"success": true, "data": {"summary": {...}, "timeline": [...]}}
"""
import json
import os
import sys

# Ensure Scripts/ and scripts/ are on sys.path for all script imports
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.dirname(os.path.abspath(__file__)), _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _template import run_script, read_stdin


def main():
    params = read_stdin()
    fund_code = params.get("fundCode")
    nav_history = params.get("navHistory", [])
    investment_type = params.get("investmentType", "monthly")
    amount = float(params.get("amount", 1000))
    initial_amount = float(params.get("initialAmount", 0))
    fee_rate = float(params.get("feeRate", 0.0015))
    take_profit_rate = params.get("takeProfitRate")
    stop_loss_rate = params.get("stopLossRate")

    if not nav_history:
        return {"error": "No NAV history provided"}

    nav_dict = {}
    dates = []
    for entry in nav_history:
        d = entry.get("date")
        nav = entry.get("nav") or entry.get("net_worth") or entry.get("value")
        if d and nav:
            nav_dict[d] = float(nav)
            dates.append(d)

    dates.sort()
    if not dates:
        return {"error": "No valid NAV data points"}

    result = _run_backtest(
        nav_dict, dates, investment_type, amount, initial_amount,
        fee_rate, take_profit_rate, stop_loss_rate
    )

    return result


import math
from datetime import datetime


def _run_backtest(
    nav_dict, dates, investment_type, amount, initial_amount, fee_rate,
    take_profit_rate=None, stop_loss_rate=None
):
    timeline = []
    total_invested = 0
    total_shares = 0

    investment_dates = []
    if investment_type == "lump_sum":
        investment_dates = [dates[0]]
    elif investment_type == "monthly":
        current_month = None
        for date in dates:
            dt = datetime.strptime(date, "%Y-%m-%d")
            month_key = (dt.year, dt.month)
            if month_key != current_month:
                investment_dates.append(date)
                current_month = month_key
    elif investment_type == "weekly":
        current_week = None
        for date in dates:
            dt = datetime.strptime(date, "%Y-%m-%d")
            week_key = (dt.year, dt.isocalendar()[1])
            if week_key != current_week:
                investment_dates.append(date)
                current_week = week_key

    sold_out = False
    exit_reason = None
    exit_date = None
    cash = 0

    for i, date in enumerate(dates):
        nav = nav_dict[date]

        if sold_out:
            timeline.append({
                "date": date, "invested": round(total_invested, 2),
                "shares": 0, "nav": round(nav, 4), "value": round(cash, 2),
                "return": round(cash - total_invested, 2),
                "return_rate": round((cash - total_invested) / total_invested * 100, 2) if total_invested > 0 else 0,
                "is_investment_day": False, "status": "sold", "exit_reason": exit_reason,
            })
            continue

        if i == 0 and initial_amount > 0:
            actual_amount = initial_amount * (1 - fee_rate)
            shares_bought = actual_amount / nav
            total_shares += shares_bought
            total_invested += initial_amount

        is_invest_day = False
        if (investment_type != "lump_sum" and date in investment_dates) or (investment_type == "lump_sum" and i == 0 and amount > 0):
            actual_amount = amount * (1 - fee_rate)
            shares_bought = actual_amount / nav
            total_shares += shares_bought
            total_invested += amount
            is_invest_day = True

        current_value = total_shares * nav
        total_return = current_value - total_invested
        return_rate = (total_return / total_invested * 100) if total_invested > 0 else 0

        triggered = False
        if total_invested > 0:
            if take_profit_rate and return_rate >= (take_profit_rate * 100):
                sold_out = True
                exit_reason = "take_profit"
                triggered = True
            elif stop_loss_rate and return_rate <= -(stop_loss_rate * 100):
                sold_out = True
                exit_reason = "stop_loss"
                triggered = True

        if triggered:
            exit_date = date
            cash = current_value
            timeline.append({
                "date": date, "invested": round(total_invested, 2),
                "shares": 0, "nav": round(nav, 4), "value": round(cash, 2),
                "return": round(cash - total_invested, 2),
                "return_rate": round((cash - total_invested) / total_invested * 100, 2),
                "is_investment_day": is_invest_day, "status": "sold", "exit_reason": exit_reason,
            })
            continue

        timeline.append({
            "date": date, "invested": round(total_invested, 2),
            "shares": round(total_shares, 4), "nav": round(nav, 4),
            "value": round(current_value, 2), "return": round(total_return, 2),
            "return_rate": round(return_rate, 2),
            "is_investment_day": is_invest_day, "status": "holding",
        })

    if not timeline:
        return {"error": "No data to backtest"}

    final_record = timeline[-1]
    max_drawdown = 0
    peak_value = 0
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
    annual_return = 0
    if years > 0 and total_return_rate > -1:
        annual_return = (pow(1 + total_return_rate, 1 / years) - 1) * 100

    returns = []
    for i in range(1, len(timeline)):
        if timeline[i - 1]["value"] > 0:
            daily_return = (timeline[i]["value"] - timeline[i - 1]["value"]) / timeline[i - 1]["value"]
            returns.append(daily_return)

    sharpe_ratio = 0
    if len(returns) > 0:
        mean_return = sum(returns) / len(returns)
        if len(returns) > 1:
            variance = sum((r - mean_return) ** 2 for r in returns) / (len(returns) - 1)
            std_dev = math.sqrt(variance)
            if std_dev > 0:
                risk_free_rate = 0.02 / 252
                sharpe_ratio = (mean_return - risk_free_rate) / std_dev * math.sqrt(252)

    return {
        "summary": {
            "total_invested": round(final_record["invested"], 2),
            "final_value": round(final_record["value"], 2),
            "total_return": round(final_record["return"], 2),
            "return_rate": round(final_record["return_rate"], 2),
            "annual_return": round(annual_return, 2),
            "max_drawdown": round(-max_drawdown, 2),
            "sharpe_ratio": round(sharpe_ratio, 2),
            "investment_count": len(investment_dates) + (1 if initial_amount > 0 else 0),
            "days": days,
            "exit_reason": exit_reason,
            "exit_date": exit_date,
        },
        "timeline": timeline,
    }


if __name__ == "__main__":
    run_script(main)
