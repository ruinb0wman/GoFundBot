from datetime import datetime

from sqlalchemy import desc

from core.logging import get_logger
from database import SessionLocal
from models import DataFetchTask, FundBasicInfo, FundEstimate, FundIndustryTag, FundRiskMetrics, FundScreeningRank
from services.fund_industry import rebuild_industry_performance_stats
from services.helpers import _json_loads, _round_or_none

from .constants import RESEARCH_FUND_GROUPS

logger = get_logger(__name__)


def _fund_type_matches(fund_type, fund_name, keywords):
    text = f"{fund_type or ''} {fund_name or ''}".upper()
    return any(str(keyword).upper() in text for keyword in keywords)


def _fund_group_key(fund_type, fund_name):
    for group in RESEARCH_FUND_GROUPS:
        if _fund_type_matches(fund_type, fund_name, group["keywords"]):
            return group["key"]
    return "other"


def _research_fund_row(basic, risk=None, rank=None, estimate=None):
    perf = _json_loads(basic.performance_json, {}) if basic else {}
    return {
        "fund_code": basic.fund_code if basic else None,
        "fund_name": basic.fund_name if basic else None,
        "fund_type": basic.fund_type if basic else None,
        "return_1m": _round_or_none(perf.get("1_month_return")),
        "return_3m": _round_or_none(perf.get("3_month_return")),
        "return_6m": _round_or_none(perf.get("6_month_return")),
        "return_1y": _round_or_none(perf.get("1_year_return") if perf else basic.return_1y),
        "return_3y": _round_or_none(perf.get("3_year_return")),
        "max_drawdown_1y": _round_or_none(risk.max_drawdown_1y if risk else None),
        "volatility_1y": _round_or_none(risk.volatility_1y if risk else None),
        "sharpe_ratio_1y": _round_or_none(risk.sharpe_ratio_1y if risk else None),
        "calmar_ratio_1y": _round_or_none(risk.calmar_ratio_1y if risk else None),
        "rank_pct_1y": _round_or_none(rank.rank_pct_1y if rank else None),
        "pass_4433": bool(rank and rank.pass_4433 == 1),
        "estimate_change": _round_or_none(estimate.estimate_change if estimate else None),
        "estimate_time": estimate.estimate_time if estimate else None,
        "nav": _round_or_none(estimate.net_worth if estimate else None, 4),
        "nav_date": estimate.net_worth_date if estimate else None,
        "updated_time": basic.updated_time.isoformat() if basic and basic.updated_time else None,
    }


def _research_base_rows(db):
    return (
        db.query(
            FundBasicInfo,
            FundRiskMetrics,
            FundScreeningRank,
            FundEstimate,
        )
        .outerjoin(FundRiskMetrics, FundBasicInfo.fund_code == FundRiskMetrics.fund_code)
        .outerjoin(FundScreeningRank, FundBasicInfo.fund_code == FundScreeningRank.fund_code)
        .outerjoin(FundEstimate, FundBasicInfo.fund_code == FundEstimate.fund_code)
        .all()
    )


def _task_to_research_status(task):
    if not task:
        return {"running": False, "status": "idle", "message": ""}
    return {
        "task_id": task.id,
        "running": task.status == "running",
        "status": task.status,
        "progress": task.current_count or 0,
        "total": task.target_count or 0,
        "success_count": task.success_count or 0,
        "fail_count": task.fail_count or 0,
        "message": task.message or "",
        "started_time": task.started_time.isoformat() if task.started_time else None,
        "finished_time": task.finished_time.isoformat() if task.finished_time else None,
    }


def _latest_research_industry_task(db):
    return (
        db.query(DataFetchTask)
        .filter(DataFetchTask.task_type == "research_industry_performance")
        .order_by(desc(DataFetchTask.started_time), desc(DataFetchTask.id))
        .first()
    )


def _run_research_industry_performance_rebuild(task_id):
    db = SessionLocal()
    try:
        task = db.query(DataFetchTask).filter(DataFetchTask.id == task_id).first()
        if task:
            total = db.query(FundIndustryTag).count()
            task.status = "running"
            task.message = "后台汇总板块行情..."
            task.target_count = total
            task.current_count = 0
            task.updated_time = datetime.now()
            db.commit()

        rebuilt_total = rebuild_industry_performance_stats(db)
        task = db.query(DataFetchTask).filter(DataFetchTask.id == task_id).first()
        if task:
            task.status = "finished"
            task.message = f"板块行情汇总完成，共 {rebuilt_total} 个板块"
            task.current_count = task.target_count or rebuilt_total
            task.success_count = rebuilt_total
            task.fail_count = 0
            task.finished_time = datetime.now()
            task.updated_time = datetime.now()
        db.commit()
    except Exception as exc:
        db.rollback()
        task = db.query(DataFetchTask).filter(DataFetchTask.id == task_id).first()
        if task:
            task.status = "failed"
            task.message = f"板块行情汇总失败: {exc}"
            task.error_message = str(exc)
            task.finished_time = datetime.now()
            task.updated_time = datetime.now()
            db.commit()
    finally:
        db.close()


from .etf_tracking import (  # noqa: E402, F401
    _build_etf_tracking_from_cache,
    _build_etf_tracking_snapshot,
    _build_research_etf_tracking,
    _refresh_etf_tracking_from_akshare,
)
from .market_stats import _build_research_fund_dashboard, _build_research_market_stats  # noqa: E402, F401
from .sector_summary import _build_research_sector_summary  # noqa: E402, F401
