from flask import jsonify, request

from core.logging import get_logger
from database import get_request_db as get_db
from fund_api import FundAPI
from models import FundRiskMetrics, FundTrend
from services.helpers import _normalize_fund_code, is_data_fresh
from services.risk_metrics import _save_risk_metrics, calculate_risk_metrics

from . import fund_bp
from .helpers import _build_cached_response, _save_fund_data_to_db

logger = get_logger(__name__)
fund_api = FundAPI()


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
