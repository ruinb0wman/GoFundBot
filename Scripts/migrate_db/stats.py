import os
import sqlite3

from migrate_db.core import DB_PATH


def print_data_stats():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        print("=" * 60)
        print("\u6570\u636e\u5e93\u7edf\u8ba1\u4fe1\u606f")
        print("=" * 60)

        tables = [
            ("fund_basic_info", "\u57fa\u7840\u4fe1\u606f"),
            ("fund_trend", "\u51c0\u503c\u8d70\u52bf"),
            ("fund_risk_metrics", "\u98ce\u9669\u6307\u6807"),
            ("fund_screening_rank", "\u6392\u540d\u6570\u636e"),
        ]

        for table, name in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            print(f"{name}: {count} \u6761\u8bb0\u5f55")

        cursor.execute("SELECT COUNT(*) FROM fund_screening_rank WHERE pass_4433 = 1")
        pass_4433 = cursor.fetchone()[0]
        print(f"\u901a\u8fc74433\u6cd5\u5219: {pass_4433} \u53ea")

        cursor.execute("""
            SELECT COUNT(*) FROM fund_risk_metrics
            WHERE volatility_1y > 500 OR ABS(sharpe_ratio_1y) > 50
        """)
        dirty_count = cursor.fetchone()[0]
        print(f"\u7591\u4f3c\u810f\u6570\u636e: {dirty_count} \u6761")

        cursor.execute("""
            SELECT COUNT(*) FROM fund_risk_metrics
            WHERE sharpe_ratio_1y IS NOT NULL
              AND volatility_1y IS NOT NULL
              AND volatility_1y < 500
        """)
        valid_1y = cursor.fetchone()[0]
        print(f"\u6709\u65481\u5e74\u671f\u98ce\u9669\u6307\u6807: {valid_1y} \u6761")

        print("\n\u57fa\u91d1\u7c7b\u578b\u5206\u5e03:")
        cursor.execute("""
            SELECT fund_type, COUNT(*)
            FROM fund_basic_info
            GROUP BY fund_type
            ORDER BY COUNT(*) DESC
            LIMIT 15
        """)
        for fund_type, count in cursor.fetchall():
            label = fund_type or "\u672a\u77e5"
            print(f"  {label}: {count}")

        print("=" * 60)

    except Exception as e:
        print(f"Error: {str(e)}")
    finally:
        conn.close()
