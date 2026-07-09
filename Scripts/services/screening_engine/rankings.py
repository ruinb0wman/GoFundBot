from datetime import datetime

from models import FundBasicInfo, FundScreeningRank
from services.helpers import _json_loads


def check_4433_rule(rank_1y, rank_2y, rank_3y, rank_5y, rank_6m, rank_3m):
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


def calculate_same_type_rankings(db):
    fund_types = (
        db.query(FundBasicInfo.fund_type)
        .filter(FundBasicInfo.fund_type.isnot(None), FundBasicInfo.fund_type != "")
        .distinct()
        .all()
    )
    fund_types = [ft[0] for ft in fund_types]

    for fund_type in fund_types:
        funds = (
            db.query(FundBasicInfo)
            .filter(FundBasicInfo.fund_type == fund_type, FundBasicInfo.performance_json.isnot(None))
            .all()
        )
        if len(funds) < 2:
            continue

        fund_performances = []
        for fund in funds:
            perf = _json_loads(fund.performance_json, {})
            fund_performances.append(
                {
                    "fund_code": fund.fund_code,
                    "return_1m": perf.get("1_month_return"),
                    "return_3m": perf.get("3_month_return"),
                    "return_6m": perf.get("6_month_return"),
                    "return_1y": perf.get("1_year_return"),
                    "return_2y": perf.get("2_year_return"),
                    "return_3y": perf.get("3_year_return"),
                }
            )

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
                    return not abs(num_val) < 0.01
                except (ValueError, TypeError):
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
            for rank_idx, (fund_code, _) in enumerate(funds_with_data, 1):
                fund_ranks[fund_code][rank_field] = round((rank_idx / total) * 100, 2)

        for fund_code, ranks in fund_ranks.items():
            rank_record = db.query(FundScreeningRank).filter(FundScreeningRank.fund_code == fund_code).first()
            if not rank_record:
                rank_record = FundScreeningRank(fund_code=fund_code)
                db.add(rank_record)
            for field, value in ranks.items():
                setattr(rank_record, field, value)
            rank_record.pass_4433 = (
                1
                if check_4433_rule(
                    ranks.get("rank_pct_1y"),
                    ranks.get("rank_pct_2y"),
                    ranks.get("rank_pct_3y"),
                    None,
                    ranks.get("rank_pct_6m"),
                    ranks.get("rank_pct_3m"),
                )
                else 0
            )
            rank_record.updated_time = datetime.now()

    db.commit()
