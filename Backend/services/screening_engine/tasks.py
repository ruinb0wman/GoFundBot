import contextlib
import time
from datetime import datetime, timedelta

from core.logging import get_logger
from database import SessionLocal
from models import FundBasicInfo, FundRiskMetrics
from services.data_service_client import get_data_service_client
from services.helpers import _normalize_fund_code
from services.risk_metrics import _save_risk_metrics, calculate_risk_metrics

from . import (
    _create_data_fetch_task,
    _fetch_screening_snapshot_items,
    _fund_type_lookup,
    _matches_fund_type,
    _save_screening_snapshot_item,
    _set_screening_progress,
    screening_stop_flag,
    screening_update_status,
)
from .rankings import calculate_same_type_rankings

logger = get_logger(__name__)


def _fund_codes_needing_industry_refresh_wrapper(db, codes, force=False):
    from services.fund_industry import _fund_codes_needing_industry_refresh

    return _fund_codes_needing_industry_refresh(db, codes, force=force)


def _refresh_fund_industry_tag_wrapper(db, code, fetch_holdings_if_missing=True):
    from services.fund_industry import _refresh_fund_industry_tag

    return _refresh_fund_industry_tag(db, code, fetch_holdings_if_missing=fetch_holdings_if_missing)


def update_single_fund_risk_metrics(fund_code, db):
    fund_code = _normalize_fund_code(fund_code)
    try:
        payload = get_data_service_client().get_fund_nav_history(fund_code)
        from services.risk_metrics import _nav_history_to_risk_input

        net_worth_trend = _nav_history_to_risk_input(payload)
        if len(net_worth_trend) < 30:
            return False
        risk_metrics = calculate_risk_metrics(net_worth_trend)
        if not risk_metrics:
            return False
        _save_risk_metrics(db, fund_code, risk_metrics)
        _refresh_fund_industry_tag_wrapper(db, fund_code, fetch_holdings_if_missing=True)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logger.warning(f"[补充风险] 异常 {fund_code}: {e}")
        return False


def _select_nav_candidates(db):
    cutoff_date = datetime.now() - timedelta(days=7)
    basic_rows = db.query(FundBasicInfo.fund_code, FundBasicInfo.fund_name, FundBasicInfo.fund_type).all()
    risk_rows = db.query(FundRiskMetrics.fund_code, FundRiskMetrics.sharpe_ratio_1y, FundRiskMetrics.updated_time).all()
    risk_map = {r.fund_code: (r.sharpe_ratio_1y, r.updated_time) for r in risk_rows}

    candidates = []
    for basic in basic_rows:
        code = basic.fund_code
        if code not in risk_map:
            candidates.append({"code": code, "name": basic.fund_name, "type": basic.fund_type or ""})
        else:
            sharpe, updated = risk_map[code]
            if sharpe is None or updated is None or updated < cutoff_date:
                candidates.append({"code": code, "name": basic.fund_name, "type": basic.fund_type or ""})

    candidates.sort(key=lambda x: x["code"])
    return candidates


def batch_update_fund_data(
    fund_types=None,
    limit=None,
    mode="sync_nav",
    task_id=None,
    industry_limit=None,
    tasks=None,
    build_industry_dictionary=True,
):
    global screening_update_status, screening_stop_flag

    tasks = tasks or {}
    update_basic = bool(tasks.get("basic", True))
    calculate_rankings_task = bool(tasks.get("rankings", update_basic))
    calculate_risk_task = bool(tasks.get("risk", mode != "sync_only"))
    refresh_industry_task = bool(tasks.get("industry", True))
    rebuild_industry_performance_task = bool(tasks.get("industry_performance", refresh_industry_task))

    db = SessionLocal()
    time.time()

    try:
        if not task_id:
            task = _create_data_fetch_task(
                db,
                "screening_update",
                {
                    "fund_types": fund_types or [],
                    "limit": limit,
                    "mode": mode,
                    "industry_limit": industry_limit,
                    "build_industry_dictionary": build_industry_dictionary,
                    "tasks": tasks,
                },
                message="获取批量排行...",
            )
            task_id = task.id

        mode = "sync_nav" if mode != "sync_only" else "sync_only"
        screening_stop_flag = False
        screening_update_status.update(
            {
                "running": True,
                "progress": 0,
                "total": 0,
                "current_fund": "",
                "success_count": 0,
                "fail_count": 0,
                "start_time": datetime.now(),
                "message": "获取批量排行...",
            }
        )
        _set_screening_progress(db, task_id, status="running", message="获取批量排行...")

        if update_basic:
            fund_list = _fetch_screening_snapshot_items(limit=limit, db=db, task_id=task_id)
        else:
            query = db.query(FundBasicInfo)
            if limit:
                with contextlib.suppress(TypeError, ValueError):
                    query = query.limit(max(1, int(limit)))
            fund_list = [
                {"code": item.fund_code, "name": item.fund_name, "type": item.fund_type} for item in query.all()
            ]

        type_lookup = _fund_type_lookup()

        if fund_types:
            fund_list = [
                item
                for item in fund_list
                if _matches_fund_type(
                    item.get("type") or type_lookup.get(_normalize_fund_code(item.get("code")), {}).get("type"),
                    fund_types,
                )
            ]

        success_count = 0
        fail_count = 0
        total_to_save = len(fund_list)

        if update_basic:
            _set_screening_progress(
                db,
                task_id,
                message="写入基础数据...",
                target_count=total_to_save,
                current_count=0,
                success_count=0,
                fail_count=0,
                current_item="",
            )
            for index, fund in enumerate(fund_list, 1):
                if screening_stop_flag:
                    _set_screening_progress(
                        db, task_id, status="stopped", message=f"已手动停止。成功: {success_count}, 失败: {fail_count}"
                    )
                    return {"success": False, "stopped": True}

                fund_code = _normalize_fund_code(fund.get("code", ""))
                if _save_screening_snapshot_item(db, fund, type_lookup):
                    success_count += 1
                else:
                    fail_count += 1

                screening_update_status.update(
                    {
                        "progress": index,
                        "current_fund": f"{fund_code} - {fund.get('name', '')}",
                        "success_count": success_count,
                        "fail_count": fail_count,
                    }
                )
                db.commit()
                _set_screening_progress(
                    db,
                    task_id,
                    current_count=index,
                    current_item=f"{fund_code} - {fund.get('name', '')}",
                    success_count=success_count,
                    fail_count=fail_count,
                )

        if not screening_stop_flag and calculate_rankings_task:
            _set_screening_progress(db, task_id, message="计算同类排名...", current_item="")
            calculate_same_type_rankings(db)

        if not screening_stop_flag and calculate_risk_task:
            candidates = _select_nav_candidates(db)
            nav_success = 0
            nav_fail = 0
            _set_screening_progress(
                db,
                task_id,
                message="补齐候选净值并计算风险指标...",
                target_count=len(candidates),
                current_count=0,
                current_item="",
            )

            for index, fund in enumerate(candidates, 1):
                if screening_stop_flag:
                    return {"success": False, "stopped": True}
                current_item = f"{fund['code']} - {fund.get('name', '')}"
                _set_screening_progress(db, task_id, current_count=index, current_item=current_item)
                if update_single_fund_risk_metrics(fund["code"], db):
                    nav_success += 1
                else:
                    nav_fail += 1
                _set_screening_progress(db, task_id, success_count=nav_success, fail_count=nav_fail)
            success_count, fail_count = nav_success, nav_fail

        if not screening_stop_flag and refresh_industry_task:
            from services.fund_industry import batch_refresh_fund_industry_tags

            industry_codes = [
                _normalize_fund_code(item.get("code")) for item in fund_list if _normalize_fund_code(item.get("code"))
            ]
            industry_result = batch_refresh_fund_industry_tags(
                db,
                fund_codes=industry_codes,
                task_id=task_id,
                force=True,
                limit=industry_limit,
                build_full_dictionary=build_industry_dictionary,
                allow_missing_stock_network=True,
            )
            success_count = industry_result["success_count"]
            fail_count = industry_result["fail_count"]

        if not screening_stop_flag and rebuild_industry_performance_task:
            _set_screening_progress(db, task_id, message="汇总行业表现...", current_item="")
            from services.fund_industry import rebuild_industry_performance_stats

            rebuild_industry_performance_stats(db)
            db.commit()

        message = f"完成。模式: {mode}, 成功: {success_count}, 失败: {fail_count}"
        _set_screening_progress(
            db,
            task_id,
            status="finished",
            message=message,
            success_count=success_count,
            fail_count=fail_count,
            current_item="",
        )
        screening_update_status["running"] = False
        return {
            "success": True,
            "total": screening_update_status["total"],
            "success_count": success_count,
            "fail_count": fail_count,
        }
    except Exception as exc:
        db.rollback()
        message = f"更新失败: {exc}"
        screening_update_status["message"] = message
        screening_update_status["running"] = False
        _set_screening_progress(db, task_id, status="failed", message=message, error_message=str(exc))
        return {"success": False, "error": str(exc)}
    finally:
        screening_update_status["running"] = False
        db.close()


def batch_fill_risk_metrics(db=None, task_id=None):
    global screening_update_status, screening_stop_flag

    own_db = None
    if db is None:
        own_db = SessionLocal()
        db = own_db

    try:
        cutoff_date = datetime.now() - timedelta(days=7)
        all_basic_codes = {row[0] for row in db.query(FundBasicInfo.fund_code).all()}

        risk_codes = set()
        stale_risk_codes = set()
        for row in db.query(
            FundRiskMetrics.fund_code, FundRiskMetrics.sharpe_ratio_1y, FundRiskMetrics.updated_time
        ).all():
            if row.sharpe_ratio_1y is not None:
                risk_codes.add(row.fund_code)
                if row.updated_time is None or row.updated_time < cutoff_date:
                    stale_risk_codes.add(row.fund_code)

        missing_risk_codes = all_basic_codes - risk_codes
        need_risk_update_codes = missing_risk_codes | stale_risk_codes
        missing_industry_codes = set(_fund_codes_needing_industry_refresh_wrapper(db, all_basic_codes, force=False))
        missing_codes = sorted(need_risk_update_codes | missing_industry_codes)

        if not missing_codes:
            from services.fund_industry import rebuild_industry_performance_stats

            rebuild_industry_performance_stats(db)
            db.commit()
            screening_update_status["running"] = False
            return {"success": True, "total": 0, "message": "所有基金已有风险指标"}

        screening_update_status.update(
            {
                "running": True,
                "progress": 0,
                "total": len(missing_codes),
                "current_fund": "",
                "success_count": 0,
                "fail_count": 0,
                "message": "补充风险指标...",
            }
        )
        _set_screening_progress(
            db,
            task_id,
            status="running",
            message="补充风险指标...",
            target_count=len(missing_codes),
            current_count=0,
            success_count=0,
            fail_count=0,
        )

        success = 0
        fail = 0
        for idx, code in enumerate(missing_codes, 1):
            if screening_stop_flag:
                _set_screening_progress(db, task_id, status="stopped", message=f"已停止。成功{success}, 失败{fail}")
                return {"success": False, "stopped": True}

            current_item = f"{code}"
            screening_update_status.update(
                {
                    "progress": idx,
                    "current_fund": current_item,
                    "success_count": success,
                    "fail_count": fail,
                }
            )

            if code in missing_risk_codes or code in stale_risk_codes:
                ok = update_single_fund_risk_metrics(code, db)
            else:
                ok = _refresh_fund_industry_tag_wrapper(db, code, fetch_holdings_if_missing=True) is not None

            if ok:
                success += 1
            else:
                fail += 1

            db.commit()
            _set_screening_progress(
                db, task_id, current_count=idx, current_item=current_item, success_count=success, fail_count=fail
            )

        from services.fund_industry import rebuild_industry_performance_stats

        rebuild_industry_performance_stats(db)
        db.commit()

        _set_screening_progress(
            db,
            task_id,
            status="finished",
            message=f"补充完成。成功{success}, 失败{fail}",
            success_count=success,
            fail_count=fail,
        )
        screening_update_status["running"] = False
        return {"success": True, "success_count": success, "fail_count": fail}
    except Exception as e:
        logger.error(f"[补充风险] 失败: {e}")
        screening_update_status["running"] = False
        _set_screening_progress(db, task_id, status="failed", message=str(e))
        return {"success": False, "error": str(e)}
    finally:
        if own_db:
            own_db.close()
