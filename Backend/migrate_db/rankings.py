import json
import os
import sqlite3
from datetime import datetime

from migrate_db.core import DB_PATH


def _check_4433_rule(rank_1y, rank_2y, rank_3y, rank_5y, rank_6m, rank_3m):
    if rank_1y is None or rank_1y > 25:
        return False

    long_term_available = [r for r in [rank_2y, rank_3y] if r is not None]
    if long_term_available:
        for rank in long_term_available:
            if rank > 25:
                return False

    if rank_5y is not None and rank_5y > 25:
        return False

    if rank_6m is None or rank_6m > 33.33:
        return False
    return not (rank_3m is None or rank_3m > 33.33)


def recalculate_all_rankings():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        print("=" * 60)
        print("\u5f00\u59cb\u91cd\u65b0\u8ba1\u7b97\u540c\u7c7b\u578b\u6392\u540d...")
        print("=" * 60)

        cursor.execute("""
            SELECT DISTINCT fund_type FROM fund_basic_info
            WHERE fund_type IS NOT NULL AND fund_type != ''
        """)
        fund_types = [row[0] for row in cursor.fetchall()]

        print(f"\u53d1\u73b0 {len(fund_types)} \u79cd\u57fa\u91d1\u7c7b\u578b")

        for fund_type in fund_types:
            cursor.execute(
                """
                SELECT fund_code, performance_json
                FROM fund_basic_info
                WHERE fund_type = ? AND performance_json IS NOT NULL
            """,
                (fund_type,),
            )
            funds = cursor.fetchall()

            if len(funds) < 2:
                continue

            print(f"\u5904\u7406 {fund_type}: {len(funds)} \u53ea\u57fa\u91d1")

            fund_performances = []
            for fund_code, perf_json in funds:
                try:
                    perf = json.loads(perf_json) if perf_json else {}
                    fund_performances.append(
                        {
                            "fund_code": fund_code,
                            "return_1m": perf.get("1_month_return"),
                            "return_3m": perf.get("3_month_return"),
                            "return_6m": perf.get("6_month_return"),
                            "return_1y": perf.get("1_year_return"),
                            "return_2y": perf.get("2_year_return"),
                            "return_3y": perf.get("3_year_return"),
                        }
                    )
                except Exception:
                    pass

            periods = [
                ("return_1m", "rank_pct_1m"),
                ("return_3m", "rank_pct_3m"),
                ("return_6m", "rank_pct_6m"),
                ("return_1y", "rank_pct_1y"),
                ("return_2y", "rank_pct_2y"),
                ("return_3y", "rank_pct_3y"),
            ]

            fund_ranks = {fp["fund_code"]: {} for fp in fund_performances}

            for return_field, rank_field in periods:

                def is_valid_return(val):
                    if val is None:
                        return False
                    try:
                        num_val = float(val)
                        return abs(num_val) >= 0.01
                    except Exception:
                        return False

                funds_with_data = [
                    (fp["fund_code"], float(fp[return_field]))
                    for fp in fund_performances
                    if is_valid_return(fp[return_field])
                ]

                if len(funds_with_data) < 2:
                    continue

                funds_with_data.sort(key=lambda x: x[1], reverse=True)
                total = len(funds_with_data)

                for rank_idx, (fc, _) in enumerate(funds_with_data, 1):
                    rank_pct = round((rank_idx / total) * 100, 2)
                    fund_ranks[fc][rank_field] = rank_pct

            for fund_code, ranks in fund_ranks.items():
                pass_4433 = _check_4433_rule(
                    ranks.get("rank_pct_1y"),
                    ranks.get("rank_pct_2y"),
                    ranks.get("rank_pct_3y"),
                    None,
                    ranks.get("rank_pct_6m"),
                    ranks.get("rank_pct_3m"),
                )

                cursor.execute(
                    """
                    INSERT OR REPLACE INTO fund_screening_rank
                    (fund_code, rank_pct_1m, rank_pct_3m, rank_pct_6m, rank_pct_1y, rank_pct_2y, rank_pct_3y, pass_4433, updated_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        fund_code,
                        ranks.get("rank_pct_1m"),
                        ranks.get("rank_pct_3m"),
                        ranks.get("rank_pct_6m"),
                        ranks.get("rank_pct_1y"),
                        ranks.get("rank_pct_2y"),
                        ranks.get("rank_pct_3y"),
                        1 if pass_4433 else 0,
                        datetime.now().isoformat(),
                    ),
                )

        conn.commit()

        cursor.execute("SELECT COUNT(*) FROM fund_screening_rank WHERE pass_4433 = 1")
        pass_4433_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM fund_screening_rank")
        total_count = cursor.fetchone()[0]

        print("=" * 60)
        print(
            f"\u6392\u540d\u8ba1\u7b97\u5b8c\u6210\uff01\u5171 {total_count} \u53ea\u57fa\u91d1\uff0c{pass_4433_count} \u53ea\u901a\u8fc74433\u6cd5\u5219"
        )

    except Exception as e:
        print(f"Error during ranking calculation: {str(e)}")
        conn.rollback()
    finally:
        conn.close()
