#!/usr/bin/env python3
"""
Query industry-related fund data.

Actions:
  funds_by_industry   — search funds by industry tag keyword
  industry_performance — get precomputed industry performance summary

stdin: {"action": "...", "keyword": "..."}  (keyword only for funds_by_industry)
stdout: {"success": true, "data": {...}}
"""
import json
import os
import sys
import traceback

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SCRIPT_DIR)
for _p in (_SCRIPT_DIR, _BACKEND_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from sqlalchemy import or_
from database import SessionLocal
from models import FundBasicInfo, FundIndustryPerformance, FundIndustryTag
from services.helpers import _json_loads


def _expand_industry_keyword(keyword: str) -> list[str]:
    from services.industry_classification import SHENWAN_SECTOR_MAP, TOPIC_RULES

    kw_upper = keyword.upper()
    terms = {keyword}

    for topic, sub_keywords in TOPIC_RULES:
        if any(kw_upper == k.upper() or kw_upper in k.upper() for k in sub_keywords):
            terms.add(topic)
            terms.update(sub_keywords)

    parent = SHENWAN_SECTOR_MAP.get(keyword)
    if parent:
        for child, p in SHENWAN_SECTOR_MAP.items():
            if p == parent:
                terms.add(child)

    for child_kw in list(terms):
        parent2 = SHENWAN_SECTOR_MAP.get(child_kw)
        if parent2:
            for child2, p2 in SHENWAN_SECTOR_MAP.items():
                if p2 == parent2:
                    terms.add(child2)

    return list(terms)


def _funds_by_industry(keyword: str) -> dict:
    if not keyword:
        return {"funds": [], "total": 0, "message": "关键词为空"}

    db = SessionLocal()
    try:
        search_terms = _expand_industry_keyword(keyword)
        conditions = [FundIndustryTag.industry_tag.like(f"%{t}%") for t in search_terms]
        tags = db.query(FundIndustryTag).filter(or_(*conditions)).limit(50).all()

        seen_codes: set[str] = set()
        funds: list[dict] = []

        if tags:
            codes = [t.fund_code for t in tags]
            seen_codes.update(codes)
            basics = {
                b.fund_code: b
                for b in db.query(FundBasicInfo).filter(FundBasicInfo.fund_code.in_(codes)).all()
            }
            for tag in tags:
                basic = basics.get(tag.fund_code)
                perf = _json_loads(basic.performance_json, {}) if basic else {}
                funds.append({
                    "fund_code": tag.fund_code,
                    "fund_name": basic.fund_name if basic else None,
                    "fund_type": basic.fund_type if basic else None,
                    "industry_tag": tag.industry_tag,
                    "industry_ratio": tag.industry_ratio,
                    "return_1m": perf.get("1_month_return"),
                    "return_3m": perf.get("3_month_return"),
                    "return_6m": perf.get("6_month_return"),
                    "return_1y": perf.get("1_year_return"),
                })

        if len(funds) < 10:
            name_query = db.query(FundBasicInfo).filter(FundBasicInfo.fund_name.like(f"%{keyword}%"))
            if seen_codes:
                name_query = name_query.filter(~FundBasicInfo.fund_code.in_(seen_codes))
            for f in name_query.limit(50).all():
                seen_codes.add(f.fund_code)
                perf = _json_loads(f.performance_json, {})
                funds.append({
                    "fund_code": f.fund_code,
                    "fund_name": f.fund_name,
                    "fund_type": f.fund_type,
                    "industry_tag": None,
                    "industry_ratio": None,
                    "return_1m": perf.get("1_month_return"),
                    "return_3m": perf.get("3_month_return"),
                    "return_6m": perf.get("6_month_return"),
                    "return_1y": perf.get("1_year_return"),
                })

        if not funds:
            return {
                "funds": [],
                "total": 0,
                "message": f"未找到与'{keyword}'相关的基金",
            }

        return {"funds": funds, "total": len(funds)}
    finally:
        db.close()


def _industry_performance() -> dict:
    db = SessionLocal()
    try:
        rows = db.query(FundIndustryPerformance).order_by(
            FundIndustryPerformance.return_3m_median.desc()
        ).all()

        items = []
        for row in rows:
            detail = _json_loads(row.detail_json, {})
            items.append({
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
                "period_counts": detail.get("period_counts", {}),
                "updated_time": row.updated_time.isoformat() if row.updated_time else None,
            })

        return {
            "items": items,
            "summary": {
                "total": len(items),
                "fund_count": sum(item.get("fund_count") or 0 for item in items),
                "updated_time": max(
                    (item["updated_time"] for item in items if item.get("updated_time")), default=None
                ),
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
                items,
                key=lambda x: x.get("return_3m_median") if x.get("return_3m_median") is not None else 9999,
            )[:8],
        }
    finally:
        db.close()


ACTIONS = {
    "funds_by_industry": lambda p: _funds_by_industry(p.get("keyword", "")),
    "industry_performance": lambda _: _industry_performance(),
}


def main():
    stdin_data = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    action = stdin_data.get("action", "")
    handler = ACTIONS.get(action)
    if not handler:
        raise ValueError(f"Unknown action: {action}. Supported: {', '.join(ACTIONS)}")
    return handler(stdin_data)


if __name__ == "__main__":
    try:
        result = main()
        print(json.dumps({"success": True, "data": result}, default=str, ensure_ascii=False))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}), file=sys.stderr)
        sys.exit(1)
