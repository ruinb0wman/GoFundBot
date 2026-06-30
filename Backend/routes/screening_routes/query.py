import math

from flask import jsonify, request
from sqlalchemy import Float, asc, cast, desc, func, or_

from core.logging import get_logger
from core.validation import validate_body
from database import get_request_db as get_db
from models import FundBasicInfo, FundExtraData, FundIndustryTag, FundRiskMetrics, FundScreeningRank
from schemas.screening_schemas import ScreeningQuerySchema
from services.helpers import _json_loads, _normalize_fund_code
from services.screening_engine import update_single_fund_risk_metrics

from . import screening_bp

logger = get_logger(__name__)


@screening_bp.route("/available-types", methods=["POST"])
def get_available_fund_types():
    data = request.get_json() or {}
    strategy = data.get("strategy")
    filters = data.get("filters", {})
    db = get_db()

    query = db.query(FundBasicInfo.fund_type).distinct()
    if strategy == "4433":
        query = query.join(FundScreeningRank, FundBasicInfo.fund_code == FundScreeningRank.fund_code).filter(
            FundScreeningRank.pass_4433 == 1
        )

    if strategy in ["high_sharpe", "low_volatility", "anti_fragile"]:
        query = query.join(FundRiskMetrics, FundBasicInfo.fund_code == FundRiskMetrics.fund_code)
        if strategy == "high_sharpe":
            query = query.filter(FundRiskMetrics.sharpe_ratio_1y > 2, FundRiskMetrics.volatility_1y < 25)
        elif strategy == "low_volatility":
            query = query.filter(FundRiskMetrics.volatility_1y < 15, FundRiskMetrics.max_drawdown_1y < 15)
        elif strategy == "anti_fragile":
            query = query.filter(FundRiskMetrics.max_drawdown_1y < 20, FundRiskMetrics.annual_return_1y > 0)

    if filters.get("fund_types"):
        type_conditions = [FundBasicInfo.fund_type.like(f"%{t}%") for t in filters["fund_types"]]
        if type_conditions:
            query = query.filter(or_(*type_conditions))

    result = query.filter(FundBasicInfo.fund_type is not None).all()
    types = sorted([r[0] for r in result if r[0]])
    return jsonify({"types": types})


@screening_bp.route("/query", methods=["POST"])
@validate_body(ScreeningQuerySchema)
def query_screening_funds():
    data = request.get_json() or {}
    filters = data.get("filters", {})
    sort_by = data.get("sort_by", "sharpe_ratio_1y")
    sort_order = data.get("sort_order", "desc")
    page = data.get("page", 1)
    page_size = data.get("page_size", 20)
    strategy = data.get("strategy")
    db = get_db()

    query = (
        db.query(FundBasicInfo, FundRiskMetrics, FundScreeningRank, FundIndustryTag)
        .outerjoin(FundRiskMetrics, FundBasicInfo.fund_code == FundRiskMetrics.fund_code)
        .outerjoin(FundScreeningRank, FundBasicInfo.fund_code == FundScreeningRank.fund_code)
        .outerjoin(FundIndustryTag, FundBasicInfo.fund_code == FundIndustryTag.fund_code)
    )

    if strategy == "4433":
        query = query.filter(FundScreeningRank.pass_4433 == 1)
    elif strategy == "high_sharpe":
        query = query.filter(FundRiskMetrics.sharpe_ratio_1y > 2, FundRiskMetrics.volatility_1y < 25)
    elif strategy == "low_volatility":
        query = query.filter(FundRiskMetrics.volatility_1y < 15, FundRiskMetrics.max_drawdown_1y < 15)
    elif strategy == "anti_fragile":
        query = query.filter(FundRiskMetrics.max_drawdown_1y < 20, FundRiskMetrics.annual_return_1y > 0)

    if filters.get("fund_types"):
        type_conditions = [FundBasicInfo.fund_type.like(f"%{t}%") for t in filters["fund_types"]]
        if type_conditions:
            query = query.filter(or_(*type_conditions))

    if filters.get("keyword"):
        kw = f"%{filters['keyword']}%"
        query = query.filter(or_(FundBasicInfo.fund_code.like(kw), FundBasicInfo.fund_name.like(kw)))

    if filters.get("return_1y_min") is not None:
        query = query.filter(FundBasicInfo.return_1y >= filters["return_1y_min"])
    if filters.get("return_1y_max") is not None:
        query = query.filter(FundBasicInfo.return_1y <= filters["return_1y_max"])

    extra_return_filter_map = {
        "return_1m": cast(func.json_extract(FundBasicInfo.performance_json, "$.1_month_return"), Float),
        "return_3m": cast(func.json_extract(FundBasicInfo.performance_json, "$.3_month_return"), Float),
        "return_6m": cast(func.json_extract(FundBasicInfo.performance_json, "$.6_month_return"), Float),
        "return_3y": cast(func.json_extract(FundBasicInfo.performance_json, "$.3_year_return"), Float),
    }
    for key, column in extra_return_filter_map.items():
        if filters.get(f"{key}_min") is not None:
            query = query.filter(column >= filters[f"{key}_min"])
        if filters.get(f"{key}_max") is not None:
            query = query.filter(column <= filters[f"{key}_max"])

    if filters.get("quick_fund_type"):
        query = query.filter(FundBasicInfo.fund_type == filters["quick_fund_type"])

    for key in ["sharpe_min", "volatility_max", "max_drawdown_max", "calmar_min"]:
        value = filters.get(key)
        if value is not None:
            cols = {
                "sharpe_min": FundRiskMetrics.sharpe_ratio_1y,
                "volatility_max": FundRiskMetrics.volatility_1y,
                "max_drawdown_max": FundRiskMetrics.max_drawdown_1y,
                "calmar_min": FundRiskMetrics.calmar_ratio_1y,
            }
            op = {"sharpe_min": ">=", "volatility_max": "<=", "max_drawdown_max": "<=", "calmar_min": ">="}
            query = query.filter(
                getattr(cols[key], f"__{op[key]}__", None)
                or (cols[key] >= value if key.endswith("_min") else cols[key] <= value)
            )

    risk_max_map = {
        "max_drawdown_3m": FundRiskMetrics.max_drawdown_3m,
        "max_drawdown_6m": FundRiskMetrics.max_drawdown_6m,
        "max_drawdown_1y": FundRiskMetrics.max_drawdown_1y,
        "max_drawdown_3y": FundRiskMetrics.max_drawdown_3y,
        "max_drawdown_all": FundRiskMetrics.max_drawdown_all,
        "volatility_1y": FundRiskMetrics.volatility_1y,
        "volatility_3y": FundRiskMetrics.volatility_3y,
    }
    risk_min_map = {
        "sharpe_ratio_1y": FundRiskMetrics.sharpe_ratio_1y,
        "sharpe_ratio_3y": FundRiskMetrics.sharpe_ratio_3y,
        "calmar_ratio_1y": FundRiskMetrics.calmar_ratio_1y,
        "calmar_ratio_3y": FundRiskMetrics.calmar_ratio_3y,
    }
    risk_range_map = {
        "annual_return_1y": FundRiskMetrics.annual_return_1y,
        "annual_return_3y": FundRiskMetrics.annual_return_3y,
    }

    for key, column in risk_max_map.items():
        if filters.get(f"{key}_max") is not None:
            query = query.filter(column <= filters[f"{key}_max"])
    for key, column in risk_min_map.items():
        if filters.get(f"{key}_min") is not None:
            query = query.filter(column >= filters[f"{key}_min"])
    for key, column in risk_range_map.items():
        if filters.get(f"{key}_min") is not None:
            query = query.filter(column >= filters[f"{key}_min"])
        if filters.get(f"{key}_max") is not None:
            query = query.filter(column <= filters[f"{key}_max"])

    rank_filter_map = {
        "rank_pct_1m": FundScreeningRank.rank_pct_1m,
        "rank_pct_3m": FundScreeningRank.rank_pct_3m,
        "rank_pct_6m": FundScreeningRank.rank_pct_6m,
        "rank_pct_1y": FundScreeningRank.rank_pct_1y,
        "rank_pct_2y": FundScreeningRank.rank_pct_2y,
        "rank_pct_3y": FundScreeningRank.rank_pct_3y,
    }
    for key, column in rank_filter_map.items():
        if filters.get(f"{key}_max") is not None:
            query = query.filter(column <= filters[f"{key}_max"])
    if filters.get("pass_4433") is True:
        query = query.filter(FundScreeningRank.pass_4433 == 1)

    sort_map = {
        "sharpe_ratio_1y": FundRiskMetrics.sharpe_ratio_1y,
        "sharpe_ratio_3y": FundRiskMetrics.sharpe_ratio_3y,
        "return_1m": cast(func.json_extract(FundBasicInfo.performance_json, "$.1_month_return"), Float),
        "return_3m": cast(func.json_extract(FundBasicInfo.performance_json, "$.3_month_return"), Float),
        "return_6m": cast(func.json_extract(FundBasicInfo.performance_json, "$.6_month_return"), Float),
        "return_1y": FundBasicInfo.return_1y,
        "return_3y": cast(func.json_extract(FundBasicInfo.performance_json, "$.3_year_return"), Float),
        "volatility_1y": FundRiskMetrics.volatility_1y,
        "volatility_3y": FundRiskMetrics.volatility_3y,
        "max_drawdown_1y": FundRiskMetrics.max_drawdown_1y,
        "max_drawdown_3m": FundRiskMetrics.max_drawdown_3m,
        "max_drawdown_6m": FundRiskMetrics.max_drawdown_6m,
        "max_drawdown_3y": FundRiskMetrics.max_drawdown_3y,
        "max_drawdown_all": FundRiskMetrics.max_drawdown_all,
        "calmar_ratio_1y": FundRiskMetrics.calmar_ratio_1y,
        "calmar_ratio_3y": FundRiskMetrics.calmar_ratio_3y,
        "annual_return_1y": FundRiskMetrics.annual_return_1y,
        "annual_return_3y": FundRiskMetrics.annual_return_3y,
        "rank_pct_1y": FundScreeningRank.rank_pct_1y,
        "rank_pct_1m": FundScreeningRank.rank_pct_1m,
        "rank_pct_3m": FundScreeningRank.rank_pct_3m,
        "rank_pct_6m": FundScreeningRank.rank_pct_6m,
        "rank_pct_2y": FundScreeningRank.rank_pct_2y,
        "rank_pct_3y": FundScreeningRank.rank_pct_3y,
        "fund_code": FundBasicInfo.fund_code,
        "fund_name": FundBasicInfo.fund_name,
        "fund_type": FundBasicInfo.fund_type,
        "industry_tag_name": FundIndustryTag.industry_tag,
        "updated_time": FundBasicInfo.updated_time,
    }

    industry_filters = [str(x).strip() for x in (filters.get("industry_tags") or []) if str(x).strip()]
    if industry_filters:
        query = query.filter(FundIndustryTag.industry_tag.in_(industry_filters))

    total_count = query.count()

    sort_column = sort_map.get(sort_by, FundRiskMetrics.sharpe_ratio_1y)
    query = query.order_by(desc(sort_column) if sort_order == "desc" else asc(sort_column))

    offset = (page - 1) * page_size
    results = query.offset(offset).limit(page_size).all()

    fund_list = []
    for basic, risk, rank, industry_tag in results:
        perf = _json_loads(basic.performance_json, {}) if basic else {}
        is_dirty_risk = risk and risk.volatility_1y and risk.volatility_1y > 1000

        def safe(v, default=None):
            return v if v is not None else default

        fund_list.append(
            {
                "fund_code": basic.fund_code if basic else None,
                "fund_name": basic.fund_name if basic else None,
                "fund_type": basic.fund_type if basic else None,
                "return_1m": perf.get("1_month_return"),
                "return_3m": perf.get("3_month_return"),
                "return_6m": perf.get("6_month_return"),
                "return_1y": perf.get("1_year_return")
                if perf.get("1_year_return") not in ["0.00", 0.0, 0, ""]
                else None,
                "return_3y": perf.get("3_year_return")
                if perf.get("3_year_return") not in ["0.00", 0.0, 0, ""]
                else None,
                "max_drawdown_3m": risk.max_drawdown_3m if risk and not is_dirty_risk else None,
                "max_drawdown_6m": risk.max_drawdown_6m if risk and not is_dirty_risk else None,
                "max_drawdown_1y": risk.max_drawdown_1y if risk and not is_dirty_risk else None,
                "max_drawdown_3y": risk.max_drawdown_3y if risk and not is_dirty_risk else None,
                "max_drawdown_all": risk.max_drawdown_all if risk and not is_dirty_risk else None,
                "volatility_1y": risk.volatility_1y if risk and not is_dirty_risk else None,
                "volatility_3y": risk.volatility_3y if risk and not is_dirty_risk else None,
                "sharpe_ratio_1y": risk.sharpe_ratio_1y if risk and not is_dirty_risk else None,
                "sharpe_ratio_3y": risk.sharpe_ratio_3y if risk and not is_dirty_risk else None,
                "calmar_ratio_1y": risk.calmar_ratio_1y if risk and not is_dirty_risk else None,
                "calmar_ratio_3y": risk.calmar_ratio_3y if risk and not is_dirty_risk else None,
                "annual_return_1y": risk.annual_return_1y if risk and not is_dirty_risk else None,
                "annual_return_3y": risk.annual_return_3y if risk and not is_dirty_risk else None,
                "rank_pct_1m": rank.rank_pct_1m if rank else None,
                "rank_pct_3m": rank.rank_pct_3m if rank else None,
                "rank_pct_6m": rank.rank_pct_6m if rank else None,
                "rank_pct_1y": rank.rank_pct_1y if rank else None,
                "rank_pct_2y": rank.rank_pct_2y if rank else None,
                "rank_pct_3y": rank.rank_pct_3y if rank else None,
                "pass_4433": (rank.pass_4433 == 1) if rank else False,
                "industry_tag": (
                    {
                        "name": industry_tag.industry_tag,
                        "ratio": industry_tag.industry_ratio,
                        "count": industry_tag.industry_count,
                        "basis": industry_tag.basis,
                        "source": industry_tag.source,
                    }
                    if industry_tag
                    else None
                ),
                "industry_tag_name": industry_tag.industry_tag if industry_tag else None,
                "updated_time": basic.updated_time.isoformat() if basic and basic.updated_time else None,
            }
        )

    return jsonify(
        {
            "total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": math.ceil(total_count / page_size) if total_count > 0 else 0,
            "data": fund_list,
        }
    )


@screening_bp.route("/strategies", methods=["GET"])
def get_screening_strategies():
    strategies = [
        {
            "id": "4433",
            "name": "4433法则",
            "description": "同类型基金中：近1/2/3年排名前25%，近3/6个月排名前33%",
            "tags": ["经典策略", "同类排名", "业绩稳定"],
        },
        {
            "id": "high_sharpe",
            "name": "高夏普比率",
            "description": "夏普比率 > 2，单位风险收益最优",
            "tags": ["风险调整", "收益优化"],
        },
        {
            "id": "low_volatility",
            "name": "低波动策略",
            "description": "波动率 < 15%，最大回撤 < 15%，稳健型",
            "tags": ["低风险", "稳健"],
        },
        {
            "id": "anti_fragile",
            "name": "反脆弱策略",
            "description": "在极端行情中表现稳健的基金",
            "tags": ["抗跌", "极端行情"],
        },
        {
            "id": "high_calmar",
            "name": "高卡玛比率",
            "description": "年化收益/最大回撤比值高，性价比最优",
            "tags": ["风险调整", "性价比"],
        },
    ]
    return jsonify({"strategies": strategies})


@screening_bp.route("/fund/<fund_code>", methods=["GET"])
def get_screening_fund_detail(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    db = get_db()
    result = (
        db.query(FundBasicInfo, FundRiskMetrics, FundScreeningRank, FundExtraData)
        .outerjoin(FundRiskMetrics, FundBasicInfo.fund_code == FundRiskMetrics.fund_code)
        .outerjoin(FundScreeningRank, FundBasicInfo.fund_code == FundScreeningRank.fund_code)
        .outerjoin(FundExtraData, FundBasicInfo.fund_code == FundExtraData.fund_code)
        .filter(FundBasicInfo.fund_code == fund_code)
        .first()
    )

    if not result:
        return jsonify({"error": "Fund not found"}), 404

    basic, risk, rank, extra = result
    perf = _json_loads(basic.performance_json, {})

    return jsonify(
        {
            "fund_code": basic.fund_code,
            "fund_name": basic.fund_name,
            "fund_type": basic.fund_type,
            "returns": {
                "1m": perf.get("1_month_return"),
                "3m": perf.get("3_month_return"),
                "6m": perf.get("6_month_return"),
                "1y": perf.get("1_year_return"),
                "2y": perf.get("2_year_return"),
                "3y": perf.get("3_year_return"),
            },
            "risk_metrics": {
                "max_drawdown_1y": risk.max_drawdown_1y if risk else None,
                "max_drawdown_3y": risk.max_drawdown_3y if risk else None,
                "volatility_1y": risk.volatility_1y if risk else None,
                "volatility_3y": risk.volatility_3y if risk else None,
                "sharpe_ratio_1y": risk.sharpe_ratio_1y if risk else None,
                "sharpe_ratio_3y": risk.sharpe_ratio_3y if risk else None,
                "calmar_ratio_1y": risk.calmar_ratio_1y if risk else None,
                "calmar_ratio_3y": risk.calmar_ratio_3y if risk else None,
            },
            "rankings": {
                "1m": rank.rank_pct_1m if rank else None,
                "3m": rank.rank_pct_3m if rank else None,
                "6m": rank.rank_pct_6m if rank else None,
                "1y": rank.rank_pct_1y if rank else None,
                "2y": rank.rank_pct_2y if rank else None,
                "3y": rank.rank_pct_3y if rank else None,
            },
            "pass_4433": (rank.pass_4433 == 1) if rank else False,
            "updated_time": basic.updated_time.isoformat() if basic.updated_time else None,
        }
    )


@screening_bp.route("/update-single/<fund_code>", methods=["POST"])
def update_single_fund(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    db = get_db()
    success = update_single_fund_risk_metrics(fund_code, db)
    if success:
        return jsonify({"message": f"Fund {fund_code} updated successfully"})
    return jsonify({"error": f"Failed to update fund {fund_code}"}), 500
