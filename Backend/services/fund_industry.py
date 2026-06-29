import re
from datetime import datetime

from sqlalchemy import desc

from core.logging import get_logger
from models import (
    FundBasicInfo,
    FundIndustryPerformance,
    FundIndustryTag,
    FundPortfolio,
    StockIndustry,
)
from services.data_service_client import get_data_service_client
from services.helpers import _json_dumps, _json_loads, _normalize_fund_code, _stats_numbers
from services.industry_classification import (
    _build_portfolio_industry_tag,
)
from services.stock_industry import (
    _fetch_stock_industry_batch,
    _resolve_stock_industries,
)
from services.stock_utils import (
    _normalize_stock_code,
    _portfolio_holding_items,
    _safe_ratio,
)

logger = get_logger(__name__)


def _enhance_portfolio_industries(db, portfolio, force_refresh=False):
    if not isinstance(portfolio, dict):
        return portfolio

    target_keys = ["stock_codes_new", "stock_codes"]
    all_holdings = []
    for key in target_keys:
        all_holdings.extend(_portfolio_holding_items(portfolio.get(key)))

    industry_map, unresolved = _resolve_stock_industries(
        db,
        all_holdings,
        force_refresh=force_refresh,
        allow_network=force_refresh,
    )

    for key in target_keys:
        items = _portfolio_holding_items(portfolio.get(key))
        if not items:
            continue
        enhanced = []
        for item in items:
            info = industry_map.get(item.get("code"), {})
            enhanced.append(
                {
                    **item,
                    "industry": info.get("industry"),
                    "region": info.get("region"),
                    "concepts": info.get("concepts") or [],
                }
            )
        portfolio[key] = enhanced

    portfolio["industry_unresolved_codes"] = unresolved
    portfolio["industry_tag"] = _build_portfolio_industry_tag(portfolio)
    return portfolio


def _upsert_fund_industry_tag(db, fund_code, tag, detail=None, unresolved_count=0):
    fund_code = _normalize_fund_code(fund_code)
    if not fund_code or not tag:
        return None

    record = db.query(FundIndustryTag).filter(FundIndustryTag.fund_code == fund_code).first()
    if not record:
        record = FundIndustryTag(fund_code=fund_code)
        db.add(record)

    record.industry_tag = tag.get("name") or "混合型"
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


def _save_portfolio_from_holdings_payload(db, fund_code, payload):
    data = payload.get("data", {}) if isinstance(payload, dict) else {}
    items = data.get("items", []) if isinstance(data, dict) else []
    if not isinstance(items, list) or not items:
        return None

    stock_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        code = _normalize_stock_code(item.get("stockCode") or item.get("code"))
        if not code:
            continue
        ratio = item.get("ratio")
        if isinstance(ratio, (int, float)) and 0 < ratio <= 1:
            ratio = round(ratio * 100, 4)
        stock_items.append(
            {
                "code": code,
                "name": item.get("stockName") or item.get("name") or code,
                "market": item.get("market"),
                "ratio": ratio,
            }
        )

    if not stock_items:
        return None

    fund_code = _normalize_fund_code(fund_code)
    record = db.query(FundPortfolio).filter(FundPortfolio.fund_code == fund_code).first()
    if not record:
        record = FundPortfolio(fund_code=fund_code)
        db.add(record)

    record.stock_codes_json = _json_dumps(stock_items)
    record.stock_codes_new_json = _json_dumps(stock_items)
    record.bond_codes_json = _json_dumps(data.get("bondCodes", []) if isinstance(data, dict) else [])
    record.bond_codes_new_json = _json_dumps(data.get("bondCodesNew", []) if isinstance(data, dict) else [])
    record.updated_time = datetime.now()
    return record


def _refresh_fund_industry_tag(
    db, fund_code, fetch_holdings_if_missing=False, force_stock_refresh=False, allow_stock_network=False
):
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
            message="构建全市场股票行业字典...",
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
        message="读取本地股票行业字典...",
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
            _set_screening_progress(db, task_id, message=f"批量补充缺失A股行业({len(missing_a_share_codes)}只)...")
            fetched_map, failed_codes = _fetch_stock_industry_batch(
                db, missing_a_share_codes, force_refresh=False, timeout=5.0
            )
            db.commit()

    success = 0
    fail = 0
    _set_screening_progress(
        db,
        task_id,
        message="刷新基金行业标签...",
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


def _build_fund_industry_exposure(db, fund_code, force_refresh=False):
    fund_code = _normalize_fund_code(fund_code)
    portfolio = db.query(FundPortfolio).filter(FundPortfolio.fund_code == fund_code).first()
    if not portfolio:
        return None

    holdings = _json_loads(portfolio.stock_codes_new_json, []) or _json_loads(portfolio.stock_codes_json, [])
    holding_items = _portfolio_holding_items(holdings)
    industry_map, unresolved = _resolve_stock_industries(
        db, holding_items, force_refresh=force_refresh, allow_network=force_refresh
    )

    exposure = {}
    enriched_holdings = []
    for item in holding_items:
        code = item.get("code")
        info = industry_map.get(code, {})
        industry = info.get("industry") or "未识别"
        ratio = _safe_ratio(item.get("ratio"))
        enriched_item = {
            **item,
            "industry": info.get("industry"),
            "region": info.get("region"),
            "concepts": info.get("concepts") or [],
        }
        enriched_holdings.append(enriched_item)
        bucket = exposure.setdefault(industry, {"industry": industry, "ratio": 0.0, "count": 0, "stocks": []})
        bucket["ratio"] += ratio
        bucket["count"] += 1
        bucket["stocks"].append({"code": code, "name": item.get("name"), "ratio": ratio})

    exposure_items = sorted(exposure.values(), key=lambda x: (x["ratio"], x["count"]), reverse=True)
    for item in exposure_items:
        item["ratio"] = round(item["ratio"], 2)

    basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
    result = {
        "fund_code": fund_code,
        "holdings": enriched_holdings,
        "industries": exposure_items,
        "industry_tag": _build_portfolio_industry_tag(
            {
                "stock_codes_new": enriched_holdings,
                "fund_name": basic.fund_name if basic else fund_code,
                "fund_type": basic.fund_type if basic else None,
            }
        ),
        "unresolved_codes": unresolved,
        "updated_time": datetime.now().isoformat(),
    }
    _upsert_fund_industry_tag(
        db, fund_code, result["industry_tag"], detail={"industries": exposure_items}, unresolved_count=len(unresolved)
    )
    return result


def _screening_industry_context(db, fund_codes):
    codes = [str(code) for code in fund_codes if code]
    if not codes:
        return {}

    persisted = db.query(FundIndustryTag).filter(FundIndustryTag.fund_code.in_(codes)).all()
    tag_map = {
        item.fund_code: {
            "name": item.industry_tag,
            "ratio": item.industry_ratio,
            "count": item.industry_count,
            "basis": item.basis,
            "source": item.source,
        }
        for item in persisted
    }
    missing_codes = [code for code in codes if code not in tag_map]
    if not missing_codes:
        return tag_map

    portfolios = db.query(FundPortfolio).filter(FundPortfolio.fund_code.in_(missing_codes)).all()
    portfolio_map = {item.fund_code: item for item in portfolios}

    stock_codes = set()
    for portfolio in portfolios:
        raw_holdings = _json_loads(portfolio.stock_codes_new_json, []) or _json_loads(portfolio.stock_codes_json, [])
        for item in _portfolio_holding_items(raw_holdings):
            if item.get("code"):
                stock_codes.add(item.get("code"))

    if stock_codes:
        records = db.query(StockIndustry).filter(StockIndustry.stock_code.in_(stock_codes)).all()
        {record.stock_code: {"industry": record.industry, "stock_name": record.stock_name} for record in records}

    for fund_code, portfolio in portfolio_map.items():
        raw_holdings = _json_loads(portfolio.stock_codes_new_json, []) or _json_loads(portfolio.stock_codes_json, [])
        basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
        tag = _build_portfolio_industry_tag(
            {
                "stock_codes_new": _portfolio_holding_items(raw_holdings),
                "fund_name": basic.fund_name if basic else None,
                "fund_type": basic.fund_type if basic else None,
            }
        )
        tag_map[fund_code] = tag
        _upsert_fund_industry_tag(db, fund_code, tag, detail={"source": "screening_cache_backfill"})
    return tag_map


def rebuild_industry_performance_stats(db):
    rows = (
        db.query(FundIndustryTag, FundBasicInfo)
        .join(FundBasicInfo, FundIndustryTag.fund_code == FundBasicInfo.fund_code)
        .all()
    )

    grouped = {}
    for tag, basic in rows:
        industry = tag.industry_tag or "混合型"
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
