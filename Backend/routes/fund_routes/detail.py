import contextlib
import os

from flask import jsonify, request

from core.logging import get_logger
from core.version_shim import deprecated_route
from database import get_request_db as get_db
from fund_api import FundAPI
from models import (
    FundBasicInfo,
    FundExtraData,
    FundPortfolio,
    FundRiskMetrics,
    FundScreeningRank,
    FundTrend,
)
from services.estimate_service import _sync_latest_official_nav, _upsert_fund_estimate
from services.fund_industry import _build_fund_industry_exposure
from services.helpers import (
    _json_dumps,
    _json_loads,
    _normalize_fund_code,
)
from services.risk_metrics import _save_risk_metrics, calculate_risk_metrics

from . import fund_bp
from .helpers import (
    _build_cached_response,
    _get_fund_detail_from_data_service,
    _sync_fund_industry_response,
    _try_data_service_fund_detail,
)

logger = get_logger(__name__)
fund_api = FundAPI()


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
