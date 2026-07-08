import json
import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "Data", "funds.db")


def migrate_database():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        print("Checking fund_risk_metrics table...")
        cursor.execute("PRAGMA table_info(fund_risk_metrics)")
        columns = [row[1] for row in cursor.fetchall()]

        columns_to_add = [
            ("calmar_ratio_1y", "FLOAT"),
            ("calmar_ratio_3y", "FLOAT"),
            ("annual_return_1y", "FLOAT"),
            ("annual_return_3y", "FLOAT"),
        ]

        for col_name, col_type in columns_to_add:
            if col_name not in columns:
                print(f"Adding column {col_name} to fund_risk_metrics...")
                cursor.execute(f"ALTER TABLE fund_risk_metrics ADD COLUMN {col_name} {col_type}")

        print("Checking fund_screening_rank table...")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='fund_screening_rank'")
        if not cursor.fetchone():
            print("Creating fund_screening_rank table...")
            cursor.execute("""
                CREATE TABLE fund_screening_rank (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    fund_code VARCHAR(6) NOT NULL UNIQUE,
                    rank_pct_1m FLOAT,
                    rank_pct_3m FLOAT,
                    rank_pct_6m FLOAT,
                    rank_pct_1y FLOAT,
                    rank_pct_2y FLOAT,
                    rank_pct_3y FLOAT,
                    rank_pct_5y FLOAT,
                    pass_4433 INTEGER DEFAULT 0,
                    updated_time DATETIME
                )
            """)
            cursor.execute("CREATE INDEX ix_fund_screening_rank_fund_code ON fund_screening_rank (fund_code)")
        else:
            print("fund_screening_rank table already exists.")

        migrate_adjustment_to_fee(conn)

        conn.commit()
        print("Migration completed successfully!")

    except Exception as e:
        print(f"Error during migration: {str(e)}")
        conn.rollback()
    finally:
        conn.close()


def migrate_adjustment_to_fee(conn=None):
    """Convert old 'adjustment' trade records to 'fee' type."""
    if conn is None:
        if not os.path.exists(DB_PATH):
            print(f"Database not found at {DB_PATH}")
            return
        conn = sqlite3.connect(DB_PATH)
        own_conn = True
    else:
        own_conn = False

    cursor = conn.cursor()
    cursor.execute("UPDATE user_trade_record SET type = 'fee' WHERE type = 'adjustment'")
    updated = cursor.rowcount
    if own_conn:
        conn.commit()
        conn.close()
    print(f"已将 {updated} 条 adjustment 记录迁移为 fee")


def clean_dirty_data():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        print("=" * 60)
        print("\u5f00\u59cb\u6e05\u7406\u810f\u6570\u636e...")
        print("=" * 60)

        cursor.execute("""
            SELECT COUNT(*) FROM fund_risk_metrics
            WHERE volatility_1y > 500
               OR volatility_3y > 500
               OR ABS(sharpe_ratio_1y) > 50
               OR ABS(sharpe_ratio_3y) > 50
        """)
        dirty_count = cursor.fetchone()[0]
        print(f"\u53d1\u73b0 {dirty_count} \u6761\u7591\u4f3c\u810f\u6570\u636e")

        cursor.execute("""
            UPDATE fund_risk_metrics
            SET
                volatility_1y = NULL,
                sharpe_ratio_1y = NULL,
                annual_return_1y = NULL,
                calmar_ratio_1y = NULL
            WHERE volatility_1y > 500 OR ABS(sharpe_ratio_1y) > 50
        """)
        print("\u5df2\u6e05\u7406 1\u5e74\u671f\u810f\u6570\u636e")

        cursor.execute("""
            UPDATE fund_risk_metrics
            SET
                volatility_3y = NULL,
                sharpe_ratio_3y = NULL,
                annual_return_3y = NULL,
                calmar_ratio_3y = NULL
            WHERE volatility_3y > 500 OR ABS(sharpe_ratio_3y) > 50
        """)
        print("\u5df2\u6e05\u7406 3\u5e74\u671f\u810f\u6570\u636e")

        conn.commit()
        print("\u810f\u6570\u636e\u6e05\u7406\u5b8c\u6210\uff01")

    except Exception as e:
        print(f"Error during cleaning: {str(e)}")
        conn.rollback()
    finally:
        conn.close()


def update_fund_types_from_cache():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    cache_path = os.path.join(os.path.dirname(DB_PATH), "fund_list_cache.json")
    if not os.path.exists(cache_path):
        print(f"Fund list cache not found at {cache_path}")
        return

    try:
        with open(cache_path, encoding="utf-8") as f:
            cache_data = json.load(f)
            funds = cache_data.get("funds", [])
            fund_type_map = {f.get("CODE"): f.get("TYPE") for f in funds if f.get("CODE") and f.get("TYPE")}
    except Exception as e:
        print(f"Error loading cache: {e}")
        return

    print(
        f"\u4ece\u7f13\u5b58\u4e2d\u52a0\u8f7d\u4e86 {len(fund_type_map)} \u53ea\u57fa\u91d1\u7684\u7c7b\u578b\u4fe1\u606f"
    )

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        print("=" * 60)
        print("\u5f00\u59cb\u66f4\u65b0\u57fa\u91d1\u7c7b\u578b...")
        print("=" * 60)

        cursor.execute("SELECT fund_code FROM fund_basic_info")
        db_fund_codes = [row[0] for row in cursor.fetchall()]

        updated_count = 0
        for fund_code in db_fund_codes:
            fund_type = fund_type_map.get(fund_code)
            if fund_type:
                cursor.execute("UPDATE fund_basic_info SET fund_type = ? WHERE fund_code = ?", (fund_type, fund_code))
                updated_count += 1

        conn.commit()
        print(f"\u6210\u529f\u66f4\u65b0\u4e86 {updated_count} \u53ea\u57fa\u91d1\u7684\u7c7b\u578b\u4fe1\u606f")

        print("\n\u66f4\u65b0\u540e\u7684\u57fa\u91d1\u7c7b\u578b\u5206\u5e03:")
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

    except Exception as e:
        print(f"Error updating fund types: {str(e)}")
        conn.rollback()
    finally:
        conn.close()


def migrate_add_return_1y():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        print("=" * 60)
        print("\u6dfb\u52a0 return_1y \u5b57\u6bb5\u5e76\u66f4\u65b0\u6570\u636e...")
        print("=" * 60)

        cursor.execute("PRAGMA table_info(fund_basic_info)")
        columns = [row[1] for row in cursor.fetchall()]

        if "return_1y" not in columns:
            print("\u6dfb\u52a0 return_1y \u5b57\u6bb5...")
            cursor.execute("ALTER TABLE fund_basic_info ADD COLUMN return_1y FLOAT")
        else:
            print("return_1y \u5b57\u6bb5\u5df2\u5b58\u5728")

        print("\u66f4\u65b0 return_1y \u6570\u636e...")
        cursor.execute("SELECT fund_code, performance_json FROM fund_basic_info WHERE performance_json IS NOT NULL")
        rows = cursor.fetchall()

        updated = 0
        for fund_code, perf_json in rows:
            try:
                perf = json.loads(perf_json) if perf_json else {}
                return_1y = perf.get("1_year_return")
                if return_1y is not None:
                    try:
                        return_1y_float = float(return_1y)
                        cursor.execute(
                            "UPDATE fund_basic_info SET return_1y = ? WHERE fund_code = ?", (return_1y_float, fund_code)
                        )
                        updated += 1
                    except (ValueError, TypeError):
                        pass
            except json.JSONDecodeError:
                pass

        conn.commit()
        print(f"\u5df2\u66f4\u65b0 {updated} \u6761\u8bb0\u5f55\u7684 return_1y \u5b57\u6bb5")
        print("\u8fc1\u79fb\u5b8c\u6210\uff01")

    except Exception as e:
        print(f"Error during migration: {str(e)}")
        conn.rollback()
    finally:
        conn.close()
