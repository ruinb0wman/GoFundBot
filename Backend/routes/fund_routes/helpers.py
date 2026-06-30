import contextlib
from datetime import datetime

import urllib3

from core.logging import get_logger
from models import (
    FundBasicInfo,
    FundEstimate,
    FundExtraData,
    FundIndustryTag,
    FundPortfolio,
    FundTrend,
)
from services.data_service_client import DataServiceError, get_data_service_client
from services.data_service_legacy_mapper import map_data_service_detail_to_legacy
from services.fund_industry import _enhance_portfolio_industries, _upsert_fund_industry_tag
from services.helpers import (
    _estimate_is_after_nav,
    _json_dumps,
    _json_loads,
    _value_to_string,
)

urllib3.disable_warnings()

logger = get_logger(__name__)


def _validate_data_service_fund_quality(mapped_data: dict):
    checks: list[tuple[str, bool]] = []

    bi = mapped_data.get("basic_info", {}) or {}
    checks.append(("basic_info.fund_code", bool(bi.get("fund_code"))))
    checks.append(("basic_info.fund_name", bool(bi.get("fund_name"))))

    est = mapped_data.get("realtime_estimate", {}) or {}
    checks.append(("realtime_estimate", bool(est and not est.get("missing"))))

    nw = mapped_data.get("net_worth_trend", [])
    checks.append(("net_worth_trend", isinstance(nw, list) and len(nw) > 0))

    pf = mapped_data.get("portfolio", {}) or {}
    sc = pf.get("stock_codes", []) if isinstance(pf, dict) else []
    checks.append(("portfolio.stock_codes", isinstance(sc, list) and len(sc) > 0))

    rm = mapped_data.get("risk_metrics", {}) or {}
    rm_values = sum(1 for v in rm.values() if v is not None) if isinstance(rm, dict) else 0
    checks.append(("risk_metrics", rm_values > 0))

    perf = mapped_data.get("performance", {}) or {}
    has_perf = any(
        perf.get(k) is not None for k in ("1_year_return", "1_month_return", "3_month_return", "6_month_return")
    )
    checks.append(("performance", has_perf))

    aa = mapped_data.get("asset_allocation", {}) or {}
    checks.append(("asset_allocation", bool(aa and not aa.get("missing"))))

    ranking_trend = mapped_data.get("ranking_trend", [])
    checks.append(("ranking_trend", isinstance(ranking_trend, list) and len(ranking_trend) > 0))

    managers = mapped_data.get("fund_managers", [])
    has_manager = isinstance(managers, list) and len(managers) > 0 and bool(managers[0].get("name"))
    checks.append(("fund_managers", has_manager))

    hs = mapped_data.get("holder_structure", {}) or {}
    hs_cats = hs.get("categories", []) if isinstance(hs, dict) else []
    checks.append(("holder_structure", len(hs_cats) > 0))

    sf = mapped_data.get("scale_fluctuation", {}) or {}
    sf_cats = sf.get("categories", []) if isinstance(sf, dict) else []
    checks.append(("scale_fluctuation", len(sf_cats) > 0))

    pt = mapped_data.get("position_trend", [])
    checks.append(("position_trend", isinstance(pt, list) and len(pt) > 0))

    sre = mapped_data.get("subscription_redemption", {}) or {}
    sre_cats = sre.get("categories", []) if isinstance(sre, dict) else []
    checks.append(("subscription_redemption", len(sre_cats) > 0))

    pe = mapped_data.get("performance_evaluation", {}) or {}
    has_pe = bool(pe.get("data") or pe.get("avr")) if isinstance(pe, dict) else False
    checks.append(("performance_evaluation", has_pe))

    issues = [name for name, ok in checks if not ok]
    total = len(checks)
    passed = total - len(issues)
    completeness_score = int(passed / total * 100) if total > 0 else 0
    return completeness_score >= 85, issues, completeness_score


def _get_fund_detail_from_data_service(fund_code):
    client = get_data_service_client()
    ds_payload = client.get_fund_detail(fund_code)
    result = map_data_service_detail_to_legacy(ds_payload)
    _, issues, completeness_score = _validate_data_service_fund_quality(result)
    result["_data_source"] = {
        "mode": "data_service",
        "mapped": True,
        "completeness_score": completeness_score,
        "replacement_tier": "tier2_gray_validation",
    }
    if issues:
        logger.warning(f"DataService fund {fund_code} completeness issues: {issues}")
    return result


def _try_data_service_fund_detail(fund_code):
    try:
        mapped = _get_fund_detail_from_data_service(fund_code)
        passed, issues, _ = _validate_data_service_fund_quality(mapped)
        return mapped, passed, issues
    except (DataServiceError, Exception) as e:
        logger.error(f"auto mode: DataService failed for {fund_code}, fallback to legacy: {e}")
        return None


def _build_cached_response(db, fund_code):
    basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
    trend = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
    estimate = db.query(FundEstimate).filter(FundEstimate.fund_code == fund_code).first()
    portfolio = db.query(FundPortfolio).filter(FundPortfolio.fund_code == fund_code).first()
    extra = db.query(FundExtraData).filter(FundExtraData.fund_code == fund_code).first()

    if not any([basic, trend, estimate, portfolio, extra]):
        return None

    data = {}

    if basic:
        data["basic_info"] = _json_loads(basic.basic_json, {})
        data["performance"] = _json_loads(basic.performance_json, {})

    if trend:
        data["net_worth_trend"] = _json_loads(trend.net_worth_trend_json, [])
        data["accumulated_net_worth"] = _json_loads(trend.accumulated_net_worth_json, [])
        data["position_trend"] = _json_loads(trend.position_trend_json, [])
        data["total_return_trend"] = _json_loads(trend.total_return_trend_json, [])
        data["ranking_trend"] = _json_loads(trend.ranking_trend_json, [])
        data["ranking_percentage"] = _json_loads(trend.ranking_percentage_json, [])
        data["scale_fluctuation"] = _json_loads(trend.scale_fluctuation_json, {})

    if estimate:
        display_estimate_change = estimate.estimate_change
        if _estimate_is_after_nav(estimate.estimate_time, estimate.net_worth_date):
            try:
                estimate_nav = float(estimate.estimate_value)
                official_nav = float(estimate.net_worth)
                if official_nav:
                    display_estimate_change = round((estimate_nav - official_nav) / official_nav * 100, 4)
            except Exception:
                display_estimate_change = estimate.estimate_change

        data["realtime_estimate"] = {
            "name": estimate.name,
            "fund_code": fund_code,
            "net_worth": estimate.net_worth,
            "net_worth_date": estimate.net_worth_date,
            "estimate_value": estimate.estimate_value,
            "estimate_change": _value_to_string(display_estimate_change),
            "estimate_time": estimate.estimate_time,
        }

    if portfolio:
        data["portfolio"] = _enhance_portfolio_industries(
            db,
            {
                "stock_codes": _json_loads(portfolio.stock_codes_json, []),
                "bond_codes": _json_loads(portfolio.bond_codes_json, []),
                "stock_codes_new": _json_loads(portfolio.stock_codes_new_json, []),
                "bond_codes_new": _json_loads(portfolio.bond_codes_new_json, []),
            },
        )
        data["fund_industry_tag"] = data["portfolio"].get("industry_tag")
        _upsert_fund_industry_tag(
            db,
            fund_code,
            data["fund_industry_tag"],
            detail={"source": "cached_response"},
            unresolved_count=len(data["portfolio"].get("industry_unresolved_codes") or []),
        )

    if extra:
        data["holder_structure"] = _json_loads(extra.holder_structure_json, {})
        data["asset_allocation"] = _json_loads(extra.asset_allocation_json, {})
        data["performance_evaluation"] = _json_loads(extra.performance_evaluation_json, {})
        data["fund_managers"] = _json_loads(extra.fund_managers_json, [])
        data["subscription_redemption"] = _json_loads(extra.subscription_redemption_json, {})
        data["same_type_funds"] = _json_loads(extra.same_type_funds_json, [])

    return data


def _sync_fund_industry_response(db, fund_code, data, source="fund_detail_response"):
    if not isinstance(data, dict):
        return data

    basic_info = data.get("basic_info", {}) if isinstance(data.get("basic_info"), dict) else {}
    portfolio = data.get("portfolio") if isinstance(data.get("portfolio"), dict) else None
    if portfolio:
        enriched_portfolio = dict(portfolio)
        enriched_portfolio["fund_name"] = basic_info.get("fund_name") or enriched_portfolio.get("fund_name")
        enriched_portfolio["fund_type"] = basic_info.get("fund_type") or enriched_portfolio.get("fund_type")
        enriched_portfolio = _enhance_portfolio_industries(db, enriched_portfolio)
        data["portfolio"] = enriched_portfolio
        tag = enriched_portfolio.get("industry_tag")
        if tag:
            _upsert_fund_industry_tag(
                db,
                fund_code,
                tag,
                detail={"source": source},
                unresolved_count=len(enriched_portfolio.get("industry_unresolved_codes") or []),
            )
            data["fund_industry_tag"] = tag

    persisted_tag = db.query(FundIndustryTag).filter(FundIndustryTag.fund_code == fund_code).first()
    if persisted_tag:
        data["fund_industry_tag"] = {
            "name": persisted_tag.industry_tag,
            "ratio": persisted_tag.industry_ratio,
            "count": persisted_tag.industry_count,
            "basis": persisted_tag.basis,
            "source": persisted_tag.source,
        }

    return data


def _save_fund_data_to_db(db, fund_code, data):
    try:
        basic_info = data.get("basic_info", {})
        performance = data.get("performance", {})
        return_1y_val = None
        with contextlib.suppress(ValueError, TypeError):
            return_1y_val = float(performance.get("1_year_return")) if performance.get("1_year_return") else None

        basic_record = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
        if basic_record:
            basic_record.fund_name = basic_info.get("fund_name", "")
            basic_record.fund_type = basic_info.get("fund_type", "")
            basic_record.return_1y = return_1y_val
            basic_record.basic_json = _json_dumps(basic_info)
            basic_record.performance_json = _json_dumps(performance)
            basic_record.updated_time = datetime.now()
        else:
            basic_record = FundBasicInfo(
                fund_code=fund_code,
                fund_name=basic_info.get("fund_name", ""),
                fund_type=basic_info.get("fund_type", ""),
                return_1y=return_1y_val,
                basic_json=_json_dumps(basic_info),
                performance_json=_json_dumps(performance),
            )
            db.add(basic_record)

        trend_record = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
        if trend_record:
            trend_record.net_worth_trend_json = _json_dumps(data.get("net_worth_trend", []))
            trend_record.accumulated_net_worth_json = _json_dumps(data.get("accumulated_net_worth", []))
            trend_record.position_trend_json = _json_dumps(data.get("position_trend", []))
            trend_record.total_return_trend_json = _json_dumps(data.get("total_return_trend", []))
            trend_record.ranking_trend_json = _json_dumps(data.get("ranking_trend", []))
            trend_record.ranking_percentage_json = _json_dumps(data.get("ranking_percentage", []))
            trend_record.scale_fluctuation_json = _json_dumps(data.get("scale_fluctuation", {}))
            trend_record.updated_time = datetime.now()
        else:
            db.add(
                FundTrend(
                    fund_code=fund_code,
                    net_worth_trend_json=_json_dumps(data.get("net_worth_trend", [])),
                    accumulated_net_worth_json=_json_dumps(data.get("accumulated_net_worth", [])),
                    position_trend_json=_json_dumps(data.get("position_trend", [])),
                    total_return_trend_json=_json_dumps(data.get("total_return_trend", [])),
                    ranking_trend_json=_json_dumps(data.get("ranking_trend", [])),
                    ranking_percentage_json=_json_dumps(data.get("ranking_percentage", [])),
                    scale_fluctuation_json=_json_dumps(data.get("scale_fluctuation", {})),
                )
            )

        extra_record = db.query(FundExtraData).filter(FundExtraData.fund_code == fund_code).first()
        if extra_record:
            extra_record.holder_structure_json = _json_dumps(data.get("holder_structure", {}))
            extra_record.asset_allocation_json = _json_dumps(data.get("asset_allocation", {}))
            extra_record.performance_evaluation_json = _json_dumps(data.get("performance_evaluation", {}))
            extra_record.fund_managers_json = _json_dumps(data.get("fund_managers", []))
            extra_record.subscription_redemption_json = _json_dumps(data.get("subscription_redemption", {}))
            extra_record.same_type_funds_json = _json_dumps(data.get("same_type_funds", []))
            extra_record.updated_time = datetime.now()
        else:
            db.add(
                FundExtraData(
                    fund_code=fund_code,
                    holder_structure_json=_json_dumps(data.get("holder_structure", {})),
                    asset_allocation_json=_json_dumps(data.get("asset_allocation", {})),
                    performance_evaluation_json=_json_dumps(data.get("performance_evaluation", {})),
                    fund_managers_json=_json_dumps(data.get("fund_managers", [])),
                    subscription_redemption_json=_json_dumps(data.get("subscription_redemption", {})),
                    same_type_funds_json=_json_dumps(data.get("same_type_funds", [])),
                )
            )

        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Error saving fund data to db: {e}")
