#!/usr/bin/env python3
"""backtest.py CLI 的输出快照测试。

动机：`python/cli/backtest.py` 是 service 通过 pythonRunner spawn 的活代码，
但此前没有任何 Python 测试覆盖。本文件把 4 个场景的 summary 固化为回归基线，
覆盖 monthly / weekly / lump_sum 三种定投方式与止盈、止损两条退出路径。

运行：python/.venv/bin/python -m unittest discover -s python/tests -v
（纯 stdlib，无额外依赖；只喂 stdin，不联网）
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKTEST_SCRIPT = REPO_ROOT / "python" / "cli" / "backtest.py"


def run_backtest(payload: dict) -> dict:
    proc = subprocess.run(
        [sys.executable, str(BACKTEST_SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0:
        raise AssertionError(f"backtest.py 退出码 {proc.returncode}: {proc.stderr}")
    return json.loads(proc.stdout)


def scenario(navs: list[tuple[str, float]], **overrides) -> dict:
    payload = {
        "fundCode": "019667",
        "navHistory": [{"date": date, "nav": nav} for date, nav in navs],
        "investmentType": "monthly",
        "amount": 1000,
        "initialAmount": 0,
        "feeRate": 0.0015,
        "takeProfitRate": None,
        "stopLossRate": None,
    }
    payload.update(overrides)
    return payload


# 4 个场景的 nav 序列（与基线一起固化，便于人工核对语义）
NAVS_MONTHLY = [
    ("2025-01-02", 1.0),
    ("2025-02-03", 1.05),
    ("2025-03-03", 0.98),
    ("2025-04-01", 1.12),
    ("2025-05-06", 1.08),
    ("2025-06-02", 1.2),
]
NAVS_WEEKLY = [
    ("2025-01-06", 1.0),
    ("2025-01-13", 1.06),
    ("2025-01-20", 1.03),
    ("2025-01-27", 1.11),
    ("2025-02-05", 1.15),
    ("2025-02-12", 1.09),
]
NAVS_LUMP_LOSS = [
    ("2025-03-03", 1.2),
    ("2025-03-10", 1.1),
    ("2025-03-17", 0.95),
    ("2025-03-24", 0.9),
    ("2025-03-31", 1.0),
]
NAVS_LUMP_PROFIT = [
    ("2025-01-02", 1.0),
    ("2025-02-03", 1.2),
    ("2025-03-03", 1.25),
]


class BacktestSummarySnapshotTest(unittest.TestCase):
    """基线取自 2026-09-29 重构前的真实输出；金额类字段精确相等（脚本已 round）。"""

    def assert_summary(self, payload: dict, expected: dict) -> None:
        result = run_backtest(payload)
        self.assertTrue(result["success"], result)
        summary = result["data"]["summary"]
        for key, value in expected.items():
            self.assertEqual(summary[key], value, f"summary.{key} 与基线不一致")

    def test_monthly_with_initial_amount(self):
        payload = scenario(NAVS_MONTHLY, initialAmount=500, amount=1000)
        self.assert_summary(
            payload,
            {
                "total_invested": 6500.0,
                "final_value": 7338.86,
                "return_rate": 12.91,
                "annual_return": 34.14,
                "max_drawdown": 0,
                "investment_count": 7,
                "days": 151,
                "exit_reason": None,
                "exit_date": None,
            },
        )
        self.assertEqual(len(run_backtest(payload)["data"]["timeline"]), len(NAVS_MONTHLY))

    def test_weekly_with_take_profit_not_triggered(self):
        payload = scenario(NAVS_WEEKLY, investmentType="weekly", amount=500, takeProfitRate=0.1)
        self.assert_summary(
            payload,
            {
                "total_invested": 3000.0,
                "final_value": 3048.6,
                "return_rate": 1.62,
                "investment_count": 6,
                "days": 37,
                "exit_reason": None,
            },
        )

    def test_lump_sum_stop_loss_exit(self):
        payload = scenario(NAVS_LUMP_LOSS, investmentType="lump_sum", amount=10000, stopLossRate=0.05)
        self.assert_summary(
            payload,
            {
                "total_invested": 10000.0,
                "final_value": 9152.92,
                "return_rate": -8.47,
                "annual_return": -68.48,
                "max_drawdown": -8.33,
                "investment_count": 1,
                "days": 28,
                "exit_reason": "stop_loss",
                "exit_date": "2025-03-10",
            },
        )

    def test_lump_sum_take_profit_exit(self):
        payload = scenario(NAVS_LUMP_PROFIT, investmentType="lump_sum", amount=10000, takeProfitRate=0.1)
        self.assert_summary(
            payload,
            {
                "total_invested": 10000.0,
                "final_value": 11982.0,
                "return_rate": 19.82,
                "annual_return": 200.64,
                "investment_count": 1,
                "days": 60,
                "exit_reason": "take_profit",
                "exit_date": "2025-02-03",
            },
        )

    def test_empty_nav_history_returns_error_payload(self):
        result = run_backtest({"fundCode": "019667", "navHistory": []})
        self.assertTrue(result["success"])
        self.assertEqual(result["data"], {"error": "No NAV history provided"})


if __name__ == "__main__":
    unittest.main()
