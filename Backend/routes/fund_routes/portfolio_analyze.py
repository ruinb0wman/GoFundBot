import contextlib
from collections import Counter

from flask import jsonify, request

from core.logging import get_logger
from database import get_request_db as get_db
from models import FundBasicInfo, FundExtraData, FundPortfolio, StockIndustry
from services.helpers import _json_loads, _normalize_fund_code

from . import fund_bp

logger = get_logger(__name__)


def _aggregate_portfolio_data(funds: list[dict]) -> dict:
    db = get_db()

    aggregated_industries: Counter = Counter()
    aggregated_assets: Counter = Counter()
    aggregated_stock_weights: dict[str, dict] = {}
    fund_details = []
    total_value = 0

    for item in funds:
        code = _normalize_fund_code(str(item.get("code", "")))
        if not code:
            continue
        weight_pct = float(item.get("weight_pct", item.get("portfolio_weight_pct", 0)))
        share = float(item.get("share", 0))
        cost = float(item.get("cost", 0))
        total_value += share * cost if share and cost else 0

        portfolio = db.query(FundPortfolio).filter(FundPortfolio.fund_code == code).first()
        extra = db.query(FundExtraData).filter(FundExtraData.fund_code == code).first()
        basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == code).first()

        basic_info = {}
        performance = {}
        stock_codes = []
        allocation = {}

        if basic:
            basic_info = _json_loads(basic.basic_json, {})
            performance = _json_loads(basic.performance_json, {})

        if portfolio:
            stock_codes = _json_loads(portfolio.stock_codes_json, [])
            if not stock_codes:
                stock_codes = _json_loads(portfolio.stock_codes_new_json, [])

        if extra:
            allocation = _json_loads(extra.asset_allocation_json, {})

        enriched_holdings = []
        for s in stock_codes:
            if isinstance(s, dict):
                entry = dict(s)
                enriched_holdings.append(entry)
                s_code = entry.get("code", "")
                s_ratio = float(entry.get("ratio", 0)) if entry.get("ratio") else 0

                industry_rec = None
                if s_code:
                    industry_rec = db.query(StockIndustry).filter(StockIndustry.stock_code == s_code[-6:]).first()

                industry_name = industry_rec.industry if industry_rec else "未知"
                entry["industry"] = industry_name

                effective_weight = s_ratio * (weight_pct / 100) if weight_pct else 0
                aggregated_industries[industry_name] += effective_weight

                clean_code = s_code[-6:]
                if clean_code not in aggregated_stock_weights:
                    aggregated_stock_weights[clean_code] = {
                        "code": clean_code,
                        "name": entry.get("name", clean_code),
                        "fund_count": 0,
                        "total_weight": 0,
                    }
                aggregated_stock_weights[clean_code]["fund_count"] += 1
                aggregated_stock_weights[clean_code]["total_weight"] += effective_weight
            else:
                enriched_holdings.append(str(s))

        # Aggregate asset allocation
        if allocation and isinstance(allocation, dict):
            cats = allocation.get("categories", [])
            series = allocation.get("series", [])
            if series and cats:
                latest = series[-1] if series else {}
                for ci in range(min(len(cats), 5)):
                    val = latest.get(cats[ci], 0)
                    if val:
                        with contextlib.suppress(ValueError, TypeError):
                            aggregated_assets[cats[ci]] += float(val) * (weight_pct / 100) if weight_pct else 0

        fund_details.append(
            {
                "basic_info": basic_info,
                "performance": performance,
                "holdings": enriched_holdings,
                "portfolio_weight_pct": weight_pct,
            }
        )

    overlap_stocks = [v for v in aggregated_stock_weights.values() if v["fund_count"] >= 2]
    overlap_stocks.sort(key=lambda x: x["total_weight"], reverse=True)

    return {
        "funds": fund_details,
        "total_value": total_value,
        "aggregated_industries": dict(aggregated_industries.most_common()),
        "aggregated_asset_allocation": dict(aggregated_assets.most_common()),
        "overlap_stocks": overlap_stocks,
    }


@fund_bp.route("/api/portfolio/analyze", methods=["POST"])
def analyze_portfolio():
    from ai_service import get_ai_service

    ai_service = get_ai_service()
    if not ai_service.is_available():
        return jsonify({"error": "AI service not configured. Please set LLM_API_KEY in .env file."}), 503

    body = request.get_json(silent=True) or {}
    funds = body.get("funds", [])
    if not funds or not isinstance(funds, list):
        return jsonify({"error": "funds list is required"}), 400

    try:
        portfolio_data = _aggregate_portfolio_data(funds)
        from services.fund_analysts.portfolio_analyst import PortfolioAnalyst

        analyst = PortfolioAnalyst(
            api_key=ai_service._api_key,
            api_base=ai_service._api_base,
            model=ai_service._model,
        )
        result = analyst.analyze(portfolio_data)
        return jsonify(result)
    except Exception as e:
        logger.error(f"组合诊断失败: {type(e).__name__}: {e}", exc_info=True)
        return jsonify({"error": f"组合诊断失败: {type(e).__name__}: {e}"}), 500
