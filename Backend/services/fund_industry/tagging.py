import re
from datetime import datetime

from core.logging import get_logger
from models import FundBasicInfo, FundIndustryTag, FundPortfolio, StockIndustry
from services.data_service_client import get_data_service_client
from services.helpers import _json_dumps, _json_loads, _normalize_fund_code
from services.industry_classification import _build_portfolio_industry_tag
from services.stock_industry import (
    _fetch_stock_industry_batch,
    _resolve_stock_industries,
)
from services.stock_utils import (
    _portfolio_holding_items,
    _safe_ratio,
)

logger = get_logger(__name__)


def _upsert_fund_industry_tag(db, fund_code, tag, detail=None, unresolved_count=0):
    fund_code = _normalize_fund_code(fund_code)
    if not fund_code or not tag:
        return None

    record = db.query(FundIndustryTag).filter(FundIndustryTag.fund_code == fund_code).first()
    if not record:
        record = FundIndustryTag(fund_code=fund_code)
        db.add(record)

    record.industry_tag = tag.get("name") or "\u6df7\u5408\u578b"
    record.industry_count = int(tag.get("count") or 0)
    record.industry_ratio = _safe_ratio(tag.get("ratio"))
    record.basis = tag.get("basis") or "mixed"
    record.source = tag.get("source") or "top_stock_holdings"
    evidence = dict(detail or {})
    evidence["classification"] = {key: value for key, value in tag.items() if key not in ("name", "ratio", "count")}
    record.detail_json = _json_dumps(evidence)
    record.unresolved_count = int(unresolved_count or 0)
    record.updated_time = datetime.now()
    return record


def _refresh_fund_industry_tag(
    db, fund_code, fetch_holdings_if_missing=False, force_stock_refresh=False, allow_stock_network=False
):
    from services.fund_industry.portfolio import _save_portfolio_from_holdings_payload

    fund_code = _normalize_fund_code(fund_code)
    if not fund_code:
        return None

    portfolio = db.query(FundPortfolio).filter(FundPortfolio.fund_code == fund_code).first()
    if not portfolio and fetch_holdings_if_missing:
        try:
            payload = get_data_service_client().get_fund_holdings(fund_code)
            portfolio = _save_portfolio_from_holdings_payload(db, fund_code, payload)
        except Exception as exc:
            logger.error(f"fund industry tag: holdings fetch failed for {fund_code}: {exc}")

    basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
    if not portfolio:
        tag = _build_portfolio_industry_tag(
            {
                "fund_name": basic.fund_name if basic else None,
                "fund_type": basic.fund_type if basic else None,
            }
        )
        return _upsert_fund_industry_tag(db, fund_code, tag, detail={"reason": "missing_holdings"}, unresolved_count=0)

    raw_holdings = _json_loads(portfolio.stock_codes_new_json, []) or _json_loads(portfolio.stock_codes_json, [])
    holding_items = _portfolio_holding_items(raw_holdings)
    industry_map, unresolved = _resolve_stock_industries(
        db,
        holding_items,
        force_refresh=force_stock_refresh,
        allow_network=allow_stock_network or force_stock_refresh,
    )

    enhanced = []
    for item in holding_items:
        info = industry_map.get(item.get("code"), {})
        enhanced.append(
            {
                **item,
                "industry": info.get("industry"),
                "region": info.get("region"),
                "concepts": info.get("concepts") or [],
            }
        )

    tag = _build_portfolio_industry_tag(
        {
            "stock_codes_new": enhanced,
            "fund_name": basic.fund_name if basic else None,
            "fund_type": basic.fund_type if basic else None,
        }
    )

    industry_counts = {}
    for item in enhanced:
        industry = item.get("industry")
        if not industry:
            continue
        bucket = industry_counts.setdefault(industry, {"count": 0, "ratio": 0.0})
        bucket["count"] += 1
        bucket["ratio"] += _safe_ratio(item.get("ratio"))

    return _upsert_fund_industry_tag(
        db,
        fund_code,
        tag,
        detail={"industries": industry_counts},
        unresolved_count=len(unresolved),
    )


def _fund_codes_needing_industry_refresh(db, candidate_codes=None, force=False):
    query = db.query(FundBasicInfo.fund_code)
    if candidate_codes is not None:
        codes = [_normalize_fund_code(code) for code in candidate_codes if _normalize_fund_code(code)]
        if not codes:
            return []
        query = query.filter(FundBasicInfo.fund_code.in_(codes))

    basic_codes = [row[0] for row in query.all() if row[0]]
    if force:
        return basic_codes

    tag_rows = db.query(FundIndustryTag).filter(FundIndustryTag.fund_code.in_(basic_codes)).all() if basic_codes else []
    tag_map = {row.fund_code: row for row in tag_rows}

    result = []
    for code in basic_codes:
        tag = tag_map.get(code)
        if not tag or not tag.industry_tag:
            result.append(code)
            continue
        if tag.basis == "mixed" and tag.source == "top_stock_holdings" and (tag.industry_count or 0) <= 0:
            result.append(code)
    return result


def batch_refresh_fund_industry_tags(
    db,
    fund_codes=None,
    task_id=None,
    force=False,
    limit=None,
    build_full_dictionary=False,
    allow_missing_stock_network=False,
):
    from services.screening_engine import _set_screening_progress, screening_stop_flag
    from services.stock_industry import (
        _collect_stock_codes_from_portfolios as _collect_stock_codes,
    )
    from services.stock_industry import (
        build_stock_industry_dictionary_from_akshare,
    )

    codes = _fund_codes_needing_industry_refresh(db, fund_codes, force=force)
    if limit is not None:
        try:
            limit = max(1, int(limit))
            codes = codes[:limit]
        except (TypeError, ValueError):
            pass

    total = len(codes)
    if total == 0:
        return {"success_count": 0, "fail_count": 0, "total": 0}

    full_dictionary_ok = False
    if build_full_dictionary:
        _set_screening_progress(
            db,
            task_id,
            message="\u6784\u5efa\u5168\u5e02\u573a\u80a1\u7968\u884c\u4e1a\u5b57\u5178...",
            target_count=total,
            current_count=0,
            success_count=0,
            fail_count=0,
            current_item="",
        )
        try:
            build_stock_industry_dictionary_from_akshare(db)
            full_dictionary_ok = True
        except Exception as exc:
            logger.error(f"[stock industry dictionary] akshare full build failed: {exc}")

    _set_screening_progress(
        db,
        task_id,
        message="\u8bfb\u53d6\u672c\u5730\u80a1\u7968\u884c\u4e1a\u5b57\u5178...",
        target_count=total,
        current_count=0,
        success_count=0,
        fail_count=0,
        current_item="",
    )
    dictionary_result = {
        "portfolio_stock_total": len(_collect_stock_codes(db, codes)),
        "mapped_stock_total": db.query(StockIndustry)
        .filter(
            StockIndustry.industry.isnot(None),
            StockIndustry.industry != "",
        )
        .count(),
    }
    logger.warning(f"[industry dictionary] local lookup: {dictionary_result}")

    if allow_missing_stock_network and (not build_full_dictionary or full_dictionary_ok):
        portfolio_stock_codes = _collect_stock_codes(db, codes)
        mapped_rows = (
            db.query(StockIndustry)
            .filter(
                StockIndustry.stock_code.in_(portfolio_stock_codes),
                StockIndustry.industry.isnot(None),
                StockIndustry.industry != "",
            )
            .all()
            if portfolio_stock_codes
            else []
        )
        mapped_codes = {row.stock_code for row in mapped_rows}
        missing_stock_codes = [code for code in portfolio_stock_codes if code not in mapped_codes]
        missing_a_share_codes = [code for code in missing_stock_codes if re.match(r"^\d{6}$", code)]
        if missing_a_share_codes:
            _set_screening_progress(
                db,
                task_id,
                message=f"\u6279\u91cf\u8865\u5145\u7f3a\u5931A\u80a1\u884c\u4e1a({len(missing_a_share_codes)}\u53ea)...",
            )
            fetched_map, failed_codes = _fetch_stock_industry_batch(
                db, missing_a_share_codes, force_refresh=False, timeout=5.0
            )
            db.commit()

    success = 0
    fail = 0
    _set_screening_progress(
        db,
        task_id,
        message="\u5237\u65b0\u57fa\u91d1\u884c\u4e1a\u6807\u7b7e...",
        target_count=total,
        current_count=0,
        success_count=0,
        fail_count=0,
        current_item="",
    )

    for index, code in enumerate(codes, 1):
        if screening_stop_flag:
            break
        _set_screening_progress(db, task_id, current_count=index, current_item=code)
        try:
            tag = _refresh_fund_industry_tag(
                db, code, fetch_holdings_if_missing=True, force_stock_refresh=False, allow_stock_network=False
            )
            if tag:
                success += 1
            else:
                fail += 1
        except Exception as exc:
            logger.error(f"batch industry tag refresh failed for {code}: {exc}")
            fail += 1
        if index % 20 == 0:
            db.commit()
            _set_screening_progress(db, task_id, success_count=success, fail_count=fail)

    db.commit()
    _set_screening_progress(db, task_id, success_count=success, fail_count=fail, current_item="")
    return {"success_count": success, "fail_count": fail, "total": total}
