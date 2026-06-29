import contextlib
import os
import re
from datetime import datetime

import requests as req
import urllib3
from flask import Blueprint, jsonify, request

from ai_service import get_ai_service
from core.logging import get_logger
from core.version_shim import deprecated_route
from database import get_request_db as get_db
from fund_api import FundAPI
from fund_list_cache import get_fund_list_cache
from models import (
    FundBasicInfo,
    FundEstimate,
    FundExtraData,
    FundIndustryTag,
    FundPortfolio,
    FundRiskMetrics,
    FundScreeningRank,
    FundTrend,
)
from services.data_service_client import DataServiceError, get_data_service_client
from services.data_service_legacy_mapper import map_data_service_detail_to_legacy
from services.estimate_service import (
    _sync_latest_official_nav,
    _upsert_fund_estimate,
)
from services.fund_industry import (
    _build_fund_industry_exposure,
    _enhance_portfolio_industries,
    _upsert_fund_industry_tag,
)
from services.helpers import (
    _estimate_is_after_nav,
    _json_dumps,
    _json_loads,
    _normalize_fund_code,
    _value_to_string,
    is_data_fresh,
)
from services.market_data import get_market_data_service as get_mds
from services.risk_metrics import _save_risk_metrics, calculate_risk_metrics

urllib3.disable_warnings()

logger = get_logger(__name__)
fund_api = FundAPI()
fund_list_cache = get_fund_list_cache()

fund_bp = Blueprint("fund", __name__, url_prefix="")


# ---------------------------------------------------------------------------
# DataService detail helpers (gray-release)
# ---------------------------------------------------------------------------


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

    # -- Additional sections (now available via EastMoney provider) --
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


# ---------------------------------------------------------------------------
# Cached response / sync helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# DB save helper
# ---------------------------------------------------------------------------


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


# ============================================================================
#  Routes
# ============================================================================


@fund_bp.route("/api/eastmoney/<path:subpath>", methods=["GET"])
def proxy_eastmoney(subpath):
    target_url = f"https://push2.eastmoney.com/{subpath}"
    query_string = request.query_string.decode("utf-8")
    if query_string:
        target_url = f"{target_url}?{query_string}"

    base_headers = {
        "Referer": "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }

    errors = []
    for use_env_proxy in [True, False]:
        try:
            s = req.Session()
            s.trust_env = use_env_proxy
            resp = s.get(target_url, headers=base_headers, timeout=10, verify=False)
            if resp.status_code == 200:
                return jsonify(resp.json())
        except Exception as exc:
            errors.append(f"{'env-proxy' if use_env_proxy else 'direct'}: {str(exc)[:80]}")

    try:
        from curl_cffi import requests as curl_requests

        for impersonate_target in ("chrome124", "chrome120", "chrome110", "chrome101", "edge101"):
            try:
                resp = curl_requests.get(
                    target_url, headers=base_headers, timeout=10, verify=False, impersonate=impersonate_target
                )
                if resp.status_code == 200:
                    return jsonify(resp.json())
            except Exception:
                continue
    except Exception as exc:
        errors.append(f"curl_cffi: {str(exc)[:80]}")

    try:
        resp = req.get(target_url, headers=base_headers, timeout=10)
        if resp.status_code == 200:
            return jsonify(resp.json())
    except Exception as exc:
        errors.append(f"default: {str(exc)[:80]}")

    logger.warning(f"东方财富代理全部失败: {'; '.join(errors)}")
    return jsonify({"error": "东方财富代理请求失败", "details": errors}), 502


@fund_bp.route("/api/fund/search", methods=["GET"])
def search_funds():
    keyword = request.args.get("q", "")
    if not keyword:
        return jsonify({"error": "Keyword is required"}), 400

    try:
        ds_payload = get_data_service_client().search_funds(keyword)
        ds_data = ds_payload.get("data", {}) if isinstance(ds_payload, dict) else {}
        ds_items = ds_data.get("items", []) if isinstance(ds_data, dict) else []
        if ds_items:
            funds = [
                {
                    "CODE": item.get("code", ""),
                    "NAME": item.get("name", ""),
                    "TYPE": item.get("type", ""),
                    "PINYIN": item.get("pinyin", ""),
                }
                for item in ds_items
                if isinstance(item, dict)
            ]
            return jsonify({"data": funds})
    except DataServiceError as e:
        logger.error(f"fund search: DataService unavailable, fallback to local cache: {e}")

    funds = fund_list_cache.search(keyword, limit=20)
    return jsonify({"data": funds})


@fund_bp.route("/api/fund/search/status", methods=["GET"])
def get_search_status():
    return jsonify(fund_list_cache.get_status())


@fund_bp.route("/api/fund/search/update", methods=["POST"])
def update_search_database():
    result = fund_list_cache.update_from_api()
    if result["success"]:
        return jsonify(result)
    return jsonify(result), 500


@fund_bp.route("/api/fund/<fund_code>", methods=["GET"])
@deprecated_route(alternative="/api/v1/fund/<fund_code>")
def get_fund_detail(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    if not fund_code:
        return jsonify({"error": "Fund code is required"}), 400

    source = request.args.get("source", "").strip().lower()
    if not source:
        source = os.environ.get("FUND_DEFAULT_SOURCE", "data_service").strip().lower()
    if source not in ("legacy", "data_service", "auto"):
        return jsonify({"success": False, "error": "Invalid source. Use legacy, data_service, or auto."}), 400

    if source == "data_service":
        db = get_db()
        result = _get_fund_detail_from_data_service(fund_code)
        result = _sync_fund_industry_response(db, fund_code, result, source="data_service_detail")
        try:
            db.commit()
        except Exception as exc:
            logger.error(f"data_service fund industry commit failed: {exc}")
            db.rollback()
        return jsonify(result)

    auto_fallback = False
    if source == "auto":
        ds_try = _try_data_service_fund_detail(fund_code)
        if ds_try is not None:
            ds_result, quality_passed, quality_issues = ds_try
            if quality_passed:
                db = get_db()
                ds_result = _sync_fund_industry_response(db, fund_code, ds_result, source="auto_data_service_detail")
                try:
                    db.commit()
                except Exception as exc:
                    logger.error(f"auto data_service fund industry commit failed: {exc}")
                    db.rollback()
                ds_result["_data_source"] = {
                    "mode": "auto",
                    "used": "data_service",
                    "fallback": False,
                    "quality_passed": True,
                    "quality_issues": [],
                }
                return jsonify(ds_result)
            else:
                logger.error(f"auto mode: quality gate failed for {fund_code}: {quality_issues}")
                auto_fallback = True
        else:
            auto_fallback = True

    db = get_db()
    fund_data = fund_api.get_fund_data(fund_code)

    if fund_data:
        basic_info = fund_data.get("basic_info", {})
        performance = fund_data.get("performance", {})
        trend = {
            "net_worth_trend": fund_data.get("net_worth_trend", []),
            "accumulated_net_worth": fund_data.get("accumulated_net_worth", []),
            "position_trend": fund_data.get("position_trend", []),
            "total_return_trend": fund_data.get("total_return_trend", []),
            "ranking_trend": fund_data.get("ranking_trend", []),
            "ranking_percentage": fund_data.get("ranking_percentage", []),
            "scale_fluctuation": fund_data.get("scale_fluctuation", {}),
        }
        estimate = fund_data.get("realtime_estimate", {})
        portfolio = fund_data.get("portfolio", {})
        fund_data = _sync_fund_industry_response(db, fund_code, fund_data, source="fund_detail")
        extra = {
            "holder_structure": fund_data.get("holder_structure", {}),
            "asset_allocation": fund_data.get("asset_allocation", {}),
            "performance_evaluation": fund_data.get("performance_evaluation", {}),
            "fund_managers": fund_data.get("fund_managers", []),
            "subscription_redemption": fund_data.get("subscription_redemption", {}),
            "same_type_funds": fund_data.get("same_type_funds", []),
        }

        basic_record = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
        if basic_record:
            basic_record.fund_name = basic_info.get("fund_name")
            basic_record.fund_type = basic_info.get("fund_type")
            basic_record.original_rate = basic_info.get("original_rate")
            basic_record.current_rate = basic_info.get("current_rate")
            basic_record.min_subscription_amount = basic_info.get("min_subscription_amount")
            basic_record.is_hb = basic_info.get("is_hb")
            basic_record.basic_json = _json_dumps(basic_info)
            basic_record.performance_json = _json_dumps(performance)
            try:
                basic_record.return_1y = (
                    float(performance.get("1_year_return")) if performance.get("1_year_return") else None
                )
            except (ValueError, TypeError):
                basic_record.return_1y = None
        else:
            return_1y_val = None
            with contextlib.suppress(ValueError, TypeError):
                return_1y_val = float(performance.get("1_year_return")) if performance.get("1_year_return") else None
            basic_record = FundBasicInfo(
                fund_code=fund_code,
                fund_name=basic_info.get("fund_name") or fund_code,
                fund_type=basic_info.get("fund_type"),
                original_rate=basic_info.get("original_rate"),
                current_rate=basic_info.get("current_rate"),
                min_subscription_amount=basic_info.get("min_subscription_amount"),
                is_hb=basic_info.get("is_hb"),
                return_1y=return_1y_val,
                basic_json=_json_dumps(basic_info),
                performance_json=_json_dumps(performance),
            )
            db.add(basic_record)

        trend_record = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
        fresh_nwt = trend["net_worth_trend"]
        if trend_record:
            if fresh_nwt:
                trend_record.net_worth_trend_json = _json_dumps(fresh_nwt)
            if trend["accumulated_net_worth"]:
                trend_record.accumulated_net_worth_json = _json_dumps(trend["accumulated_net_worth"])
            if trend["position_trend"]:
                trend_record.position_trend_json = _json_dumps(trend["position_trend"])
            if trend["total_return_trend"]:
                trend_record.total_return_trend_json = _json_dumps(trend["total_return_trend"])
            if trend["ranking_trend"]:
                trend_record.ranking_trend_json = _json_dumps(trend["ranking_trend"])
            if trend["ranking_percentage"]:
                trend_record.ranking_percentage_json = _json_dumps(trend["ranking_percentage"])
            if trend["scale_fluctuation"]:
                trend_record.scale_fluctuation_json = _json_dumps(trend["scale_fluctuation"])
        else:
            db.add(
                FundTrend(
                    fund_code=fund_code,
                    net_worth_trend_json=_json_dumps(fresh_nwt),
                    accumulated_net_worth_json=_json_dumps(trend["accumulated_net_worth"]),
                    position_trend_json=_json_dumps(trend["position_trend"]),
                    total_return_trend_json=_json_dumps(trend["total_return_trend"]),
                    ranking_trend_json=_json_dumps(trend["ranking_trend"]),
                    ranking_percentage_json=_json_dumps(trend["ranking_percentage"]),
                    scale_fluctuation_json=_json_dumps(trend["scale_fluctuation"]),
                )
            )

        estimate_result = _upsert_fund_estimate(
            db,
            fund_code,
            name=estimate.get("name"),
            net_worth=estimate.get("net_worth"),
            net_worth_date=estimate.get("net_worth_date"),
            estimate_value=estimate.get("estimate_value"),
            estimate_change=estimate.get("estimate_change"),
            estimate_time=estimate.get("estimate_time"),
        )
        estimate_result = _sync_latest_official_nav(db, fund_code, estimate_result)
        if isinstance(estimate_result, dict):
            fund_data["realtime_estimate"] = {
                **estimate,
                "net_worth": estimate_result.get("net_worth"),
                "net_worth_date": estimate_result.get("net_worth_date"),
                "estimate_value": estimate_result.get("estimate_value"),
                "estimate_change": estimate_result.get("estimate_change"),
                "estimate_time": estimate_result.get("estimate_time"),
            }

        portfolio_record = db.query(FundPortfolio).filter(FundPortfolio.fund_code == fund_code).first()
        if portfolio_record:
            portfolio_record.stock_codes_json = _json_dumps(portfolio.get("stock_codes", []))
            portfolio_record.bond_codes_json = _json_dumps(portfolio.get("bond_codes", []))
            portfolio_record.stock_codes_new_json = _json_dumps(portfolio.get("stock_codes_new", []))
            portfolio_record.bond_codes_new_json = _json_dumps(portfolio.get("bond_codes_new", []))
        else:
            db.add(
                FundPortfolio(
                    fund_code=fund_code,
                    stock_codes_json=_json_dumps(portfolio.get("stock_codes", [])),
                    bond_codes_json=_json_dumps(portfolio.get("bond_codes", [])),
                    stock_codes_new_json=_json_dumps(portfolio.get("stock_codes_new", [])),
                    bond_codes_new_json=_json_dumps(portfolio.get("bond_codes_new", [])),
                )
            )

        extra_record = db.query(FundExtraData).filter(FundExtraData.fund_code == fund_code).first()
        if extra_record:
            extra_record.holder_structure_json = _json_dumps(extra["holder_structure"])
            extra_record.asset_allocation_json = _json_dumps(extra["asset_allocation"])
            extra_record.performance_evaluation_json = _json_dumps(extra["performance_evaluation"])
            extra_record.fund_managers_json = _json_dumps(extra["fund_managers"])
            extra_record.subscription_redemption_json = _json_dumps(extra["subscription_redemption"])
            extra_record.same_type_funds_json = _json_dumps(extra["same_type_funds"])
        else:
            db.add(
                FundExtraData(
                    fund_code=fund_code,
                    holder_structure_json=_json_dumps(extra["holder_structure"]),
                    asset_allocation_json=_json_dumps(extra["asset_allocation"]),
                    performance_evaluation_json=_json_dumps(extra["performance_evaluation"]),
                    fund_managers_json=_json_dumps(extra["fund_managers"]),
                    subscription_redemption_json=_json_dumps(extra["subscription_redemption"]),
                    same_type_funds_json=_json_dumps(extra["same_type_funds"]),
                )
            )

        net_worth_trend = fund_data.get("net_worth_trend", [])
        if net_worth_trend and len(net_worth_trend) >= 30:
            risk_metrics = calculate_risk_metrics(net_worth_trend)
            if risk_metrics:
                _save_risk_metrics(db, fund_code, risk_metrics)
                fund_data["risk_metrics"] = risk_metrics

        try:
            db.commit()
        except Exception as e:
            logger.error(f"Error saving to database: {e}")
            db.rollback()

        if auto_fallback:
            fund_data["_data_source"] = {
                "mode": "auto",
                "used": "legacy",
                "fallback": True,
                "quality_passed": False,
                "quality_issues": ["quality gate not passed — using legacy fallback"],
            }

        return jsonify(fund_data)

    cached_data = _build_cached_response(db, fund_code)
    if cached_data:
        cached_data = _sync_fund_industry_response(db, fund_code, cached_data, source="cached_response")
        try:
            db.commit()
        except Exception as exc:
            logger.error(f"cached fund industry commit failed: {exc}")
            db.rollback()
        return jsonify(cached_data)

    return jsonify({"error": "Fund not found"}), 404


@fund_bp.route("/api/fund/<fund_code>/industry-exposure", methods=["GET"])
def get_fund_industry_exposure(fund_code):
    db = get_db()
    force_refresh = request.args.get("refresh", "").lower() in ("1", "true", "yes")
    result = _build_fund_industry_exposure(db, fund_code, force_refresh=force_refresh)
    if result is None:
        return jsonify({"success": False, "error": "No portfolio data found for this fund."}), 404
    try:
        db.commit()
    except Exception as exc:
        logger.error(f"industry exposure commit failed: {exc}")
        db.rollback()
    return jsonify({"success": True, "data": result})


@fund_bp.route("/api/stock/<code>/quote", methods=["GET"])
def get_stock_quote(code):
    try:
        mds = get_mds()
        quote = mds.get_realtime_quote(code, use_cache=True)
        if not quote:
            return jsonify({"success": False, "error": f"未找到股票 {code} 的行情数据"}), 404
        return jsonify({"success": True, "data": quote})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@fund_bp.route("/api/stock/<code>/kline", methods=["GET"])
def get_stock_kline(code):
    period = request.args.get("period", "daily")
    adjust = request.args.get("adjust", "qfq")
    start_date = request.args.get("startDate", "")
    end_date = request.args.get("endDate", "")
    try:
        normalized_code = re.sub(r"^(sh|sz|bj|SH|SZ|BJ)|\.(SH|SZ|BJ)$", "", code.strip())
        mds = get_mds()
        result = mds.get_a_stock_kline(
            normalized_code, klt=period, fqt=adjust, start_date=start_date, end_date=end_date
        )
        if not result.get("success"):
            return jsonify(result), 404
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@fund_bp.route("/api/market/daily", methods=["GET"])
def get_daily_market():
    try:
        ai_service = get_ai_service()
        if not ai_service.is_available():
            return jsonify({"error": "AI service not configured. Please set LLM_API_KEY in .env"}), 503
        from fund_master_service import FundMasterService
        from services.market_data import get_market_data_service as get_mds

        service = FundMasterService()
        mds = get_mds()
        market_data = {
            "indices": service.get_market_overview(),
            "sectors": mds.get_industry_boards(page_size=500),
            "news": service.get_flash_news()[:10],
        }
        result = ai_service.generate_market_summary(market_data)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@fund_bp.route("/api/fund/<fund_code>/analyze", methods=["GET"])
def analyze_fund(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    if not fund_code:
        return jsonify({"error": "Fund code is required"}), 400
    fund_data = fund_api.get_fund_data(fund_code)
    if not fund_data:
        return jsonify({"error": "Fund data not found"}), 404
    try:
        ai_service = get_ai_service()
        if not ai_service.is_available():
            return jsonify({"error": "AI service not configured. Please set LLM_API_KEY in .env file."}), 503
        result = ai_service.analyze_fund(fund_data)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@fund_bp.route("/api/fund/<fund_code>/basic", methods=["GET"])
def get_fund_basic(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    if not fund_code:
        return jsonify({"error": "Fund code is required"}), 400
    fund_data = fund_api.get_fund_data(fund_code)
    if fund_data and fund_data.get("basic_info"):
        result = {**fund_data.get("basic_info", {}), **fund_data.get("performance", {})}
        return jsonify(result)

    db = get_db()
    basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
    if basic:
        basic_info = _json_loads(basic.basic_json, {})
        performance = _json_loads(basic.performance_json, {})
        return jsonify({**basic_info, **performance})

    return jsonify({"error": "Fund basic info not found"}), 404


@fund_bp.route("/api/fund/<fund_code>/trend", methods=["GET"])
def get_fund_trend(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    if not fund_code:
        return jsonify({"error": "Fund code is required"}), 400

    fund_data = fund_api.get_fund_data(fund_code)
    if fund_data and "net_worth_trend" in fund_data:
        return jsonify(
            {
                "net_worth_trend": fund_data["net_worth_trend"],
                "accumulated_net_worth": fund_data.get("accumulated_net_worth", []),
            }
        )

    db = get_db()
    trend = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
    if trend:
        return jsonify(
            {
                "net_worth_trend": _json_loads(trend.net_worth_trend_json, []),
                "accumulated_net_worth": _json_loads(trend.accumulated_net_worth_json, []),
            }
        )

    return jsonify({"error": "Fund trend data not found"}), 404


@fund_bp.route("/api/fund/<fund_code>/compare-data", methods=["GET"])
def get_fund_compare_data(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    db = get_db()
    force_refresh = request.args.get("refresh", "false").lower() == "true"

    try:
        trend_record = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
        risk_record = db.query(FundRiskMetrics).filter(FundRiskMetrics.fund_code == fund_code).first()

        use_cache = not force_refresh and trend_record and is_data_fresh(trend_record.updated_time, days=7)

        if use_cache:
            data = _build_cached_response(db, fund_code)
            if data:
                risk_data_valid = (
                    risk_record
                    and is_data_fresh(risk_record.updated_time, days=7)
                    and risk_record.sharpe_ratio_1y is not None
                )
                if risk_data_valid and risk_record.volatility_1y and risk_record.volatility_1y > 1000:
                    risk_data_valid = False
                if risk_data_valid:
                    data["risk_metrics"] = {
                        "max_drawdown_3m": risk_record.max_drawdown_3m,
                        "max_drawdown_6m": risk_record.max_drawdown_6m,
                        "max_drawdown_1y": risk_record.max_drawdown_1y,
                        "max_drawdown_3y": risk_record.max_drawdown_3y,
                        "max_drawdown_all": risk_record.max_drawdown_all,
                        "sharpe_ratio_1y": risk_record.sharpe_ratio_1y,
                        "sharpe_ratio_3y": risk_record.sharpe_ratio_3y,
                        "volatility_1y": risk_record.volatility_1y,
                        "volatility_3y": risk_record.volatility_3y,
                        "annual_return_1y": risk_record.annual_return_1y,
                        "annual_return_3y": risk_record.annual_return_3y,
                        "calmar_ratio_1y": risk_record.calmar_ratio_1y,
                        "calmar_ratio_3y": risk_record.calmar_ratio_3y,
                    }
                else:
                    net_worth_trend = data.get("net_worth_trend", [])
                    risk_metrics = calculate_risk_metrics(net_worth_trend)
                    if risk_metrics:
                        _save_risk_metrics(db, fund_code, risk_metrics)
                        db.commit()
                        data["risk_metrics"] = risk_metrics
                    else:
                        data["risk_metrics"] = {}
                data["data_source"] = "cache"
                data["cache_time"] = trend_record.updated_time.isoformat() if trend_record.updated_time else None
                return jsonify(data)

        api_data = fund_api.get_fund_data(fund_code)
        if not api_data:
            if trend_record:
                data = _build_cached_response(db, fund_code)
                if data:
                    if risk_record and risk_record.sharpe_ratio_1y is not None:
                        data["risk_metrics"] = {
                            "max_drawdown_3m": risk_record.max_drawdown_3m,
                            "max_drawdown_6m": risk_record.max_drawdown_6m,
                            "max_drawdown_1y": risk_record.max_drawdown_1y,
                            "max_drawdown_3y": risk_record.max_drawdown_3y,
                            "max_drawdown_all": risk_record.max_drawdown_all,
                            "sharpe_ratio_1y": risk_record.sharpe_ratio_1y,
                            "sharpe_ratio_3y": risk_record.sharpe_ratio_3y,
                            "volatility_1y": risk_record.volatility_1y,
                            "volatility_3y": risk_record.volatility_3y,
                            "annual_return_1y": risk_record.annual_return_1y,
                            "annual_return_3y": risk_record.annual_return_3y,
                            "calmar_ratio_1y": risk_record.calmar_ratio_1y,
                            "calmar_ratio_3y": risk_record.calmar_ratio_3y,
                        }
                    else:
                        net_worth_trend = data.get("net_worth_trend", [])
                        risk_metrics = calculate_risk_metrics(net_worth_trend)
                        if risk_metrics:
                            _save_risk_metrics(db, fund_code, risk_metrics)
                            db.commit()
                        data["risk_metrics"] = risk_metrics or {}
                    data["data_source"] = "stale_cache"
                    return jsonify(data)
            return jsonify({"error": "Failed to fetch fund data"}), 500

        net_worth_trend = api_data.get("net_worth_trend", [])
        risk_metrics = calculate_risk_metrics(net_worth_trend)
        _save_fund_data_to_db(db, fund_code, api_data)
        if risk_metrics:
            _save_risk_metrics(db, fund_code, risk_metrics)
        db.commit()

        api_data["risk_metrics"] = risk_metrics or {}
        api_data["data_source"] = "api"
        return jsonify(api_data)

    except Exception as e:
        logger.error(f"Error fetching fund compare data: {e}")
        db.rollback()
        return jsonify({"error": str(e)}), 500


@fund_bp.route("/api/fund/<fund_code>/data-versions", methods=["GET"])
def get_fund_data_versions(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    db = get_db()
    basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
    trend = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
    risk = db.query(FundRiskMetrics).filter(FundRiskMetrics.fund_code == fund_code).first()
    rank = db.query(FundScreeningRank).filter(FundScreeningRank.fund_code == fund_code).first()

    return jsonify(
        {
            "fund_code": fund_code,
            "basic_info": {
                "exists": basic is not None,
                "updated_time": basic.updated_time.isoformat() if basic and basic.updated_time else None,
            },
            "trend": {
                "exists": trend is not None,
                "updated_time": trend.updated_time.isoformat() if trend and trend.updated_time else None,
            },
            "risk_metrics": {
                "exists": risk is not None,
                "updated_time": risk.updated_time.isoformat() if risk and risk.updated_time else None,
                "has_valid_data": risk.sharpe_ratio_1y is not None if risk else False,
            },
            "screening_rank": {
                "exists": rank is not None,
                "updated_time": rank.updated_time.isoformat() if rank and rank.updated_time else None,
                "pass_4433": (rank.pass_4433 == 1) if rank else None,
            },
        }
    )
