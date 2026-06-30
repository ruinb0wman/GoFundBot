from migrate_db.core import (
    DB_PATH,
    clean_dirty_data,
    migrate_add_return_1y,
    migrate_database,
    update_fund_types_from_cache,
)
from migrate_db.rankings import recalculate_all_rankings
from migrate_db.risk_metrics import recalculate_all_risk_metrics
from migrate_db.stats import print_data_stats

__all__ = [
    "DB_PATH",
    "migrate_database",
    "clean_dirty_data",
    "recalculate_all_risk_metrics",
    "recalculate_all_rankings",
    "print_data_stats",
    "update_fund_types_from_cache",
    "migrate_add_return_1y",
]


def main():
    import sys

    if len(sys.argv) > 1:
        command = sys.argv[1]
        if command == "migrate":
            migrate_database()
        elif command == "clean":
            clean_dirty_data()
        elif command == "recalc-risk":
            recalculate_all_risk_metrics()
        elif command == "recalc-rank":
            recalculate_all_rankings()
        elif command == "update-types":
            update_fund_types_from_cache()
        elif command == "stats":
            print_data_stats()
        elif command == "all":
            print("\u5f00\u59cb\u6267\u884c\u5b8c\u6574\u6570\u636e\u4fee\u590d\u6d41\u7a0b...")
            migrate_database()
            clean_dirty_data()
            update_fund_types_from_cache()
            recalculate_all_risk_metrics()
            recalculate_all_rankings()
            print_data_stats()
        elif command == "fix-rank":
            print("\u5f00\u59cb\u4fee\u590d\u6392\u540d\u6570\u636e...")
            update_fund_types_from_cache()
            recalculate_all_rankings()
            print_data_stats()
        elif command == "add-return":
            migrate_add_return_1y()
        else:
            print(f"\u672a\u77e5\u547d\u4ee4: {command}")
            print("\u53ef\u7528\u547d\u4ee4:")
            print("  migrate      - \u6267\u884c\u6570\u636e\u5e93\u8fc1\u79fb")
            print("  clean        - \u6e05\u7406\u810f\u6570\u636e")
            print("  recalc-risk  - \u91cd\u65b0\u8ba1\u7b97\u98ce\u9669\u6307\u6807")
            print("  recalc-rank  - \u91cd\u65b0\u8ba1\u7b97\u6392\u540d")
            print("  update-types - \u4ece\u7f13\u5b58\u66f4\u65b0\u57fa\u91d1\u7c7b\u578b")
            print("  stats        - \u67e5\u770b\u6570\u636e\u7edf\u8ba1")
            print("  all          - \u6267\u884c\u5b8c\u6574\u4fee\u590d\u6d41\u7a0b")
            print(
                "  fix-rank     - \u4fee\u590d\u6392\u540d\uff08\u66f4\u65b0\u7c7b\u578b+\u91cd\u7b97\u6392\u540d\uff09"
            )
            print("  add-return   - \u6dfb\u52a0return_1y\u5b57\u6bb5\u7528\u4e8e\u6392\u5e8f")
    else:
        migrate_database()
        print("\n\u63d0\u793a: \u53ef\u4f7f\u7528\u4ee5\u4e0b\u547d\u4ee4\u6267\u884c\u5176\u4ed6\u64cd\u4f5c:")
        print("  python migrate_db.py clean       - \u6e05\u7406\u810f\u6570\u636e")
        print("  python migrate_db.py recalc-risk - \u91cd\u65b0\u8ba1\u7b97\u98ce\u9669\u6307\u6807")
        print("  python migrate_db.py recalc-rank - \u91cd\u65b0\u8ba1\u7b97\u6392\u540d")
        print("  python migrate_db.py update-types- \u4ece\u7f13\u5b58\u66f4\u65b0\u57fa\u91d1\u7c7b\u578b")
        print("  python migrate_db.py stats       - \u67e5\u770b\u6570\u636e\u7edf\u8ba1")
        print("  python migrate_db.py all         - \u6267\u884c\u5b8c\u6574\u4fee\u590d\u6d41\u7a0b")
        print("  python migrate_db.py fix-rank    - \u4fee\u590d\u6392\u540d\u6570\u636e")
        print("  python migrate_db.py add-return  - \u6dfb\u52a0return_1y\u5b57\u6bb5")


if __name__ == "__main__":
    main()
