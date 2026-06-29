import math
import threading
from datetime import datetime

from flask import Blueprint, jsonify, request
from sqlalchemy import Float, asc, cast, desc, func, or_

from core.logging import get_logger
from core.validation import validate_body
from database import SessionLocal
from database import get_request_db as get_db
from models import (
    FundBasicInfo,
    FundExtraData,
    FundIndustryTag,
    FundNavHistory,
    FundPortfolio,
    FundRiskMetrics,
    FundScreeningRank,
    StockIndustry,
)
from schemas.screening_schemas import ScreeningQuerySchema
from services.fund_industry import (
    _screening_industry_context,
    batch_refresh_fund_industry_tags,
    rebuild_industry_performance_stats,
)
from services.helpers import (
    _json_loads,
    _normalize_fund_code,
)
from services.industry_classification import (
    SHENWAN_SECTOR_MAP,
)
from services.screening_engine import (
    _create_data_fetch_task,
    _is_active_task,
    _latest_active_task,
    _task_to_update_status,
    batch_fill_risk_metrics,
    batch_update_fund_data,
    calculate_same_type_rankings,
    screening_update_status,
    update_single_fund_risk_metrics,
)
from services.stock_industry import (
    _collect_stock_codes_from_portfolios,
    build_stock_industry_dictionary_from_akshare,
    warm_stock_industry_dictionary,
)

logger = get_logger(__name__)

screening_bp = Blueprint("screening", __name__, url_prefix="/api/screening")


@screening_bp.route("/fill-risk", methods=["POST"])
def start_fill_risk():
    global screening_update_status
    if screening_update_status.get("running"):
        return jsonify({"error": "已有更新任务在进行中"}), 409

    def _run():
        db = SessionLocal()
        try:
            task = _create_data_fetch_task(db, "fill_risk", message="补充风险指标...")
            batch_fill_risk_metrics(db=db, task_id=task.id)
        except Exception as e:
            logger.warning(f"[补充风险] 线程异常: {e}")
            screening_update_status["running"] = False
        finally:
            db.close()

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return jsonify({"message": "补充风险指标任务已启动"})


@screening_bp.route("/status", methods=["GET"])
def get_screening_status():
    db = get_db()
    basic_count = db.query(FundBasicInfo).count()
    risk_count = db.query(FundRiskMetrics).filter(FundRiskMetrics.sharpe_ratio_1y.isnot(None)).count()
    rank_count = db.query(FundScreeningRank).count()
    industry_tag_count = db.query(FundIndustryTag).count()
    nav_history_count = db.query(FundNavHistory).count()
    pass_4433_count = db.query(FundScreeningRank).filter(FundScreeningRank.pass_4433 == 1).count()

    latest = db.query(FundBasicInfo).order_by(desc(FundBasicInfo.updated_time)).first()
    latest_update = latest.updated_time.isoformat() if latest and latest.updated_time else None

    type_counts = {}
    types = (
        db.query(FundBasicInfo.fund_type, func.count(FundBasicInfo.fund_code)).group_by(FundBasicInfo.fund_type).all()
    )
    for t, c in types:
        if t:
            type_counts[t] = c

    latest_task = _latest_active_task(db)
    if latest_task and latest_task.status == "running" and not _is_active_task(latest_task):
        db.commit()

    return jsonify(
        {
            "basic_count": basic_count,
            "risk_metrics_count": risk_count,
            "ranking_count": rank_count,
            "industry_tag_count": industry_tag_count,
            "nav_history_count": nav_history_count,
            "pass_4433_count": pass_4433_count,
            "latest_update": latest_update,
            "type_counts": type_counts,
            "update_status": _task_to_update_status(latest_task),
        }
    )


@screening_bp.route("/progress", methods=["GET"])
def get_screening_progress():
    try:
        db = get_db()
        task = _latest_active_task(db)
    except Exception:
        task = None

    result = {
        "running": screening_update_status.get("running", False),
        "progress": screening_update_status.get("progress", 0),
        "total": screening_update_status.get("total", 0),
        "current_fund": screening_update_status.get("current_fund", ""),
        "success_count": screening_update_status.get("success_count", 0),
        "fail_count": screening_update_status.get("fail_count", 0),
        "message": screening_update_status.get("message", ""),
    }

    if task:
        if task.status == "running":
            result["running"] = True
            if task.target_count:
                result["total"] = task.target_count
            if task.current_count is not None:
                result["progress"] = task.current_count
            if task.current_item:
                result["current_fund"] = task.current_item
            if task.success_count is not None:
                result["success_count"] = task.success_count
            if task.fail_count is not None:
                result["fail_count"] = task.fail_count
            if task.message:
                result["message"] = task.message
            if not screening_update_status.get("running"):
                screening_update_status["running"] = True
        elif task.status in ("finished", "stopped", "failed"):
            result["running"] = False
            result["message"] = task.message or result["message"]

    return jsonify(result)


@screening_bp.route("/update", methods=["POST"])
def start_screening_update():
    data = request.get_json() or {}
    fund_types = data.get("fund_types") or []
    limit = data.get("limit")
    mode = data.get("mode") or "sync_nav"
    industry_limit = data.get("industry_limit")
    build_industry_dictionary = bool(data.get("build_industry_dictionary", True))
    tasks = data.get("tasks") or {}
    db = get_db()
    latest_task = _latest_active_task(db)

    active_task_running = _is_active_task(latest_task)
    if latest_task and latest_task.status != "running":
        db.commit()

    if screening_update_status["running"] or active_task_running:
        return jsonify(
            {
                "error": "更新任务正在进行中",
                "status": _task_to_update_status(latest_task),
            }
        ), 409

    task = _create_data_fetch_task(
        db,
        "screening_update",
        {
            "fund_types": fund_types,
            "limit": limit,
            "mode": mode,
            "industry_limit": industry_limit,
            "build_industry_dictionary": build_industry_dictionary,
            "tasks": tasks,
        },
        message="更新任务已启动",
    )

    thread = threading.Thread(
        target=batch_update_fund_data,
        args=(fund_types, limit, mode, task.id, industry_limit, tasks, build_industry_dictionary),
    )
    thread.daemon = True
    thread.start()

    return jsonify(
        {
            "message": "更新任务已启动",
            "fund_types": fund_types,
            "limit": limit,
            "mode": mode,
            "industry_limit": industry_limit,
            "build_industry_dictionary": build_industry_dictionary,
            "tasks": tasks,
            "task_id": task.id,
        }
    )


@screening_bp.route("/stop", methods=["POST"])
def stop_screening_update():
    global screening_stop_flag, screening_update_status
    screening_stop_flag = True
    screening_update_status["running"] = False
    screening_update_status["message"] = "已手动停止"
    db = get_db()
    try:
        task = _latest_active_task(db)
        if task and task.status == "running":
            task.status = "stopped"
            task.message = "已手动停止"
            task.finished_time = datetime.now()
            task.updated_time = datetime.now()
            db.commit()
    except Exception:
        pass
    return jsonify({"message": "已停止并重置状态"})


@screening_bp.route("/recalculate-rankings", methods=["POST"])
def recalculate_rankings():
    db = get_db()
    try:
        calculate_same_type_rankings(db)
        stats = (
            db.query(
                FundBasicInfo.fund_type,
                func.count(FundScreeningRank.fund_code).label("total"),
                func.sum(FundScreeningRank.pass_4433).label("pass_count"),
            )
            .join(FundScreeningRank, FundBasicInfo.fund_code == FundScreeningRank.fund_code)
            .group_by(FundBasicInfo.fund_type)
            .all()
        )

        type_stats = {}
        for fund_type, total, pass_count in stats:
            if fund_type:
                type_stats[fund_type] = {
                    "total": total,
                    "pass_4433": pass_count or 0,
                    "pass_rate": round((pass_count or 0) / total * 100, 2) if total > 0 else 0,
                }
        return jsonify({"success": True, "message": "同类型排名计算完成", "stats": type_stats})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


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


@screening_bp.route("/industry-tags", methods=["GET"])
def get_screening_industry_tags():
    db = get_db()
    if db.query(FundIndustryTag).count() == 0:
        fund_codes = [row[0] for row in db.query(FundPortfolio.fund_code).all() if row[0]]
        _screening_industry_context(db, fund_codes)
        rebuild_industry_performance_stats(db)
        try:
            db.commit()
        except Exception:
            db.rollback()

    stats = {}
    rows = (
        db.query(FundIndustryTag.industry_tag, func.count(FundIndustryTag.fund_code))
        .group_by(FundIndustryTag.industry_tag)
        .all()
    )
    for name, count in rows:
        name = name or "混合型"
        item = stats.setdefault(name, {"name": name, "count": 0})
        item["count"] += count or 0

    items = sorted(stats.values(), key=lambda x: x["count"], reverse=True)

    FUND_TYPE_GROUPS = {"固收类", "宽基指数", "策略概念"}
    NON_SHENWAN_GROUPS = {
        "全球市场": [
            "港股",
            "美股",
            "全球市场",
            "印度市场",
            "越南市场",
            "日本市场",
            "德国市场",
            "法国市场",
            "英国市场",
            "韩国市场",
            "东南亚市场",
            "新兴市场",
            "港股科技",
            "美股科技",
            "海外",
        ],
        "固收类": ["债券型", "货币型", "纯债", "可转债"],
        "策略概念": ["红利", "量化", "灵活配置", "行业轮动", "价值", "成长"],
        "宽基指数": [
            "沪深300",
            "中证500",
            "上证50",
            "创业板指",
            "科创50",
            "中证1000",
            "中证2000",
            "宽基",
            "指数",
            "指数基金",
            "指数联接",
        ],
    }

    groups = {}
    ungrouped = []
    for item in items:
        name = item["name"]
        sector = SHENWAN_SECTOR_MAP.get(name)
        if not sector:
            for group_name, tag_list in NON_SHENWAN_GROUPS.items():
                if name in tag_list:
                    sector = group_name
                    break
        if sector:
            g = groups.setdefault(sector, {"name": sector, "tags": [], "count": 0})
            g["tags"].append(item)
            g["count"] += item["count"]
        else:
            ungrouped.append(item)

    result_groups = sorted(groups.values(), key=lambda g: -g["count"])
    for g in result_groups:
        g["tags"] = sorted(g["tags"], key=lambda t: -t["count"])

    fund_type_groups = [g for g in result_groups if g["name"] in FUND_TYPE_GROUPS]
    sector_groups = [g for g in result_groups if g["name"] not in FUND_TYPE_GROUPS]

    return jsonify(
        {
            "fundTypeGroups": fund_type_groups,
            "sectorGroups": sector_groups,
            "ungrouped": sorted(ungrouped, key=lambda t: -t["count"]),
        }
    )


@screening_bp.route("/rebuild-industry-tags", methods=["POST"])
def rebuild_screening_industry_tags():
    db = get_db()
    data = request.get_json() or {}
    force = bool(data.get("force", True))
    limit = data.get("limit")
    fund_codes = [row[0] for row in db.query(FundBasicInfo.fund_code).all() if row[0]]
    try:
        result = batch_refresh_fund_industry_tags(
            db,
            fund_codes=fund_codes,
            force=force,
            limit=limit,
            build_full_dictionary=True,
            allow_missing_stock_network=True,
        )
        rebuild_industry_performance_stats(db)
    except Exception as exc:
        db.rollback()
        return jsonify({"success": False, "error": str(exc)}), 500
    db.commit()
    return jsonify({"success": True, "total": len(fund_codes), "processed": result})


@screening_bp.route("/stock-industry/status", methods=["GET"])
def get_stock_industry_status():
    db = get_db()
    total = db.query(StockIndustry).count()
    with_industry = (
        db.query(StockIndustry).filter(StockIndustry.industry.isnot(None), StockIndustry.industry != "").count()
    )
    portfolio_stock_total = len(_collect_stock_codes_from_portfolios(db))
    latest = db.query(StockIndustry).order_by(desc(StockIndustry.updated_time)).first()
    return jsonify(
        {
            "total": total,
            "with_industry": with_industry,
            "missing_industry": max(total - with_industry, 0),
            "portfolio_stock_total": portfolio_stock_total,
            "portfolio_stock_unmapped": max(portfolio_stock_total - with_industry, 0),
            "latest_update": latest.updated_time.isoformat() if latest and latest.updated_time else None,
        }
    )


@screening_bp.route("/stock-industry/warmup", methods=["POST"])
def warmup_stock_industry():
    db = get_db()
    data = request.get_json() or {}
    force = bool(data.get("force"))
    limit = data.get("limit")
    fund_codes = data.get("fund_codes")
    if isinstance(fund_codes, str):
        fund_codes = [code.strip() for code in fund_codes.split(",") if code.strip()]
    try:
        result = warm_stock_industry_dictionary(
            db, fund_codes=fund_codes if isinstance(fund_codes, list) else None, force=force, limit=limit
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        return jsonify({"success": False, "error": str(exc)}), 500
    return jsonify({"success": True, "data": result})


@screening_bp.route("/stock-industry/build-akshare", methods=["POST"])
def build_stock_industry_from_akshare():
    db = get_db()
    data = request.get_json() or {}
    try:
        result = build_stock_industry_dictionary_from_akshare(
            db, force=bool(data.get("force")), board_limit=data.get("board_limit"), stock_limit=data.get("stock_limit")
        )
    except Exception as exc:
        db.rollback()
        return jsonify({"success": False, "error": str(exc)}), 500
    return jsonify({"success": True, "data": result})


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
