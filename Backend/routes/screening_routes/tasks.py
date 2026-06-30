import threading
from datetime import datetime

from flask import jsonify, request
from sqlalchemy import desc, func

from core.logging import get_logger
from database import SessionLocal
from database import get_request_db as get_db
from models import FundBasicInfo, FundRiskMetrics, FundScreeningRank
from services.screening_engine import (
    _create_data_fetch_task,
    _is_active_task,
    _latest_active_task,
    _task_to_update_status,
    batch_fill_risk_metrics,
    batch_update_fund_data,
    calculate_same_type_rankings,
    screening_update_status,
)

from . import screening_bp

logger = get_logger(__name__)


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
    industry_tag_count = db.query(FundScreeningRank).count()
    nav_history_count = db.query(FundBasicInfo).count()
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
