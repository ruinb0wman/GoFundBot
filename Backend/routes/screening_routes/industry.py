from flask import jsonify, request
from sqlalchemy import desc, func

from core.logging import get_logger
from database import get_request_db as get_db
from models import FundBasicInfo, FundIndustryTag, FundPortfolio, StockIndustry
from services.fund_industry import (
    _screening_industry_context,
    batch_refresh_fund_industry_tags,
    rebuild_industry_performance_stats,
)
from services.industry_classification import SHENWAN_SECTOR_MAP
from services.stock_industry import (
    _collect_stock_codes_from_portfolios,
    build_stock_industry_dictionary_from_akshare,
    warm_stock_industry_dictionary,
)

from . import screening_bp

logger = get_logger(__name__)


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
