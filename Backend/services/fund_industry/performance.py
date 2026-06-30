from datetime import datetime

from sqlalchemy import desc

from models import FundBasicInfo, FundIndustryPerformance, FundIndustryTag
from services.helpers import _json_loads, _stats_numbers


def rebuild_industry_performance_stats(db):
    rows = (
        db.query(FundIndustryTag, FundBasicInfo)
        .join(FundBasicInfo, FundIndustryTag.fund_code == FundBasicInfo.fund_code)
        .all()
    )

    grouped = {}
    for tag, basic in rows:
        industry = tag.industry_tag or "\u6df7\u5408\u578b"
        perf = _json_loads(basic.performance_json, {}) if basic else {}
        bucket = grouped.setdefault(
            industry,
            {
                "funds": [],
                "return_3m": [],
                "return_6m": [],
                "return_1y": [],
                "return_3y": [],
            },
        )
        bucket["funds"].append(
            {"fund_code": basic.fund_code, "fund_name": basic.fund_name, "fund_type": basic.fund_type}
        )
        bucket["return_3m"].append(perf.get("3_month_return"))
        bucket["return_6m"].append(perf.get("6_month_return"))
        bucket["return_1y"].append(perf.get("1_year_return"))
        bucket["return_3y"].append(perf.get("3_year_return"))

    existing = {row.industry_tag: row for row in db.query(FundIndustryPerformance).all()}
    touched = set()

    for industry, bucket in grouped.items():
        stat_3m = _stats_numbers(bucket["return_3m"])
        stat_6m = _stats_numbers(bucket["return_6m"])
        stat_1y = _stats_numbers(bucket["return_1y"])
        stat_3y = _stats_numbers(bucket["return_3y"])

        record = existing.get(industry)
        if not record:
            record = FundIndustryPerformance(industry_tag=industry)
            db.add(record)

        record.fund_count = len(bucket["funds"])
        record.return_3m_avg = stat_3m["avg"]
        record.return_3m_median = stat_3m["median"]
        record.return_6m_avg = stat_6m["avg"]
        record.return_6m_median = stat_6m["median"]
        record.return_1y_avg = stat_1y["avg"]
        record.return_1y_median = stat_1y["median"]
        record.return_3y_avg = stat_3y["avg"]
        record.return_3y_median = stat_3y["median"]
        record.positive_3m_rate = stat_3m["positive_rate"]
        record.positive_6m_rate = stat_6m["positive_rate"]
        record.positive_1y_rate = stat_1y["positive_rate"]
        record.positive_3y_rate = stat_3y["positive_rate"]
        from services.helpers import _json_dumps

        record.detail_json = _json_dumps(
            {
                "period_counts": {
                    "3m": stat_3m["count"],
                    "6m": stat_6m["count"],
                    "1y": stat_1y["count"],
                    "3y": stat_3y["count"],
                },
                "funds": bucket["funds"][:50],
            }
        )
        record.updated_time = datetime.now()
        touched.add(industry)

    for industry, record in existing.items():
        if industry not in touched:
            db.delete(record)

    return len(touched)


def _industry_performance_payload(db):
    rows = db.query(FundIndustryPerformance).order_by(desc(FundIndustryPerformance.return_3m_median)).all()
    items = []
    for row in rows:
        detail = _json_loads(row.detail_json, {})
        items.append(
            {
                "industry": row.industry_tag,
                "fund_count": row.fund_count,
                "return_3m_avg": row.return_3m_avg,
                "return_3m_median": row.return_3m_median,
                "return_6m_avg": row.return_6m_avg,
                "return_6m_median": row.return_6m_median,
                "return_1y_avg": row.return_1y_avg,
                "return_1y_median": row.return_1y_median,
                "return_3y_avg": row.return_3y_avg,
                "return_3y_median": row.return_3y_median,
                "positive_3m_rate": row.positive_3m_rate,
                "positive_6m_rate": row.positive_6m_rate,
                "positive_1y_rate": row.positive_1y_rate,
                "positive_3y_rate": row.positive_3y_rate,
                "period_counts": detail.get("period_counts", {}) if isinstance(detail, dict) else {},
                "updated_time": row.updated_time.isoformat() if row.updated_time else None,
            }
        )

    return {
        "items": items,
        "summary": {
            "total": len(items),
            "fund_count": sum(item.get("fund_count") or 0 for item in items),
            "updated_time": max((item.get("updated_time") for item in items if item.get("updated_time")), default=None),
        },
        "top_3m": sorted(
            items,
            key=lambda x: x.get("return_3m_median") if x.get("return_3m_median") is not None else -9999,
            reverse=True,
        )[:8],
        "top_1y": sorted(
            items,
            key=lambda x: x.get("return_1y_median") if x.get("return_1y_median") is not None else -9999,
            reverse=True,
        )[:8],
        "weak_3m": sorted(
            items, key=lambda x: x.get("return_3m_median") if x.get("return_3m_median") is not None else 9999
        )[:8],
    }
