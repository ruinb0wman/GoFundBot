import contextlib
import time
from datetime import datetime, timedelta

from sqlalchemy import desc

from core.logging import get_logger
from database import SessionLocal
from models import (
    DataFetchTask,
    FundBasicInfo,
    FundRiskMetrics,
    FundScreeningRank,
)
from services.data_service_client import DataServiceError, get_data_service_client
from services.fund_industry import _fund_codes_needing_industry_refresh, _refresh_fund_industry_tag
from services.helpers import (
    _json_dumps,
    _json_loads,
    _normalize_fund_code,
)
from services.risk_metrics import _save_risk_metrics, calculate_risk_metrics

logger = get_logger(__name__)

SCREENING_SNAPSHOT_TYPES = ["gp", "hh", "zq", "zs", "qdii", "fof"]

screening_update_status = {
    "running": False,
    "progress": 0,
    "total": 0,
    "current_fund": "",
    "success_count": 0,
    "fail_count": 0,
    "start_time": None,
    "message": "",
}
screening_stop_flag = False


def _fund_type_lookup():
    from fund_list_cache import get_fund_list_cache

    cache = get_fund_list_cache()
    lookup = {}
    for item in cache.fund_list:
        code = _normalize_fund_code(item.get("CODE", ""))
        if code:
            lookup[code] = {
                "name": item.get("NAME") or "",
                "type": item.get("TYPE") or "",
            }
    return lookup


def _matches_fund_type(fund_type, selected_types):
    if not selected_types:
        return True
    text = str(fund_type or "")
    return any(str(selected or "") in text for selected in selected_types)


def _snapshot_performance(item):
    return {
        "1_month_return": item.get("return1m"),
        "3_month_return": item.get("return3m"),
        "6_month_return": item.get("return6m"),
        "1_year_return": item.get("return1y"),
        "2_year_return": item.get("return2y"),
        "3_year_return": item.get("return3y"),
        "ytd_return": item.get("ytd"),
        "since_inception_return": item.get("sinceInception"),
    }


def _save_screening_snapshot_item(db, item, type_lookup):
    code = _normalize_fund_code(item.get("code", ""))
    if not code:
        return False

    cached = type_lookup.get(code, {})
    fund_name = item.get("name") or cached.get("name") or code
    fund_type = item.get("type") or cached.get("type") or ""
    performance = _snapshot_performance(item)
    basic_info = {
        "fund_code": code,
        "fund_name": fund_name,
        "fund_type": fund_type,
        "net_worth": item.get("nav"),
        "net_worth_date": item.get("navDate"),
        "fee": item.get("fee"),
        "source": item.get("source"),
    }

    record = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == code).first()
    if record:
        if record.updated_time and (datetime.now() - record.updated_time) < timedelta(days=7):
            return True
        record.fund_name = fund_name
        record.fund_type = fund_type
        record.return_1y = item.get("return1y")
        record.basic_json = _json_dumps(basic_info)
        record.performance_json = _json_dumps(performance)
        record.updated_time = datetime.now()
    else:
        db.add(
            FundBasicInfo(
                fund_code=code,
                fund_name=fund_name,
                fund_type=fund_type,
                return_1y=item.get("return1y"),
                basic_json=_json_dumps(basic_info),
                performance_json=_json_dumps(performance),
            )
        )

    _refresh_fund_industry_tag(db, code, fetch_holdings_if_missing=False)
    return True


def _fetch_screening_snapshot_items(limit=None, db=None, task_id=None):
    items = []
    max_count = int(limit) if limit else None
    client = get_data_service_client()
    total_types = len(SCREENING_SNAPSHOT_TYPES)
    time.time()

    for idx, type_code in enumerate(SCREENING_SNAPSHOT_TYPES, 1):
        if max_count and len(items) >= max_count:
            break
        time.time()
        _set_screening_progress(
            db, task_id, message=f"获取排行 ({idx}/{total_types}): {type_code}", current_count=len(items)
        )

        try:
            payload = client.get_fund_screening_snapshot([type_code], page_size=500, sort="1nzf")
        except (DataServiceError, Exception) as e:
            logger.error(f"[筛查更新] {type_code}: {e}")
            continue

        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        page_items = data.get("items", []) if isinstance(data, dict) else []
        remaining = None if max_count is None else max_count - len(items)
        new_items = page_items if remaining is None else page_items[:remaining]
        items.extend(new_items)
        _set_screening_progress(
            db, task_id, message=f"获取排行 ({idx}/{total_types}): {type_code} ✓", current_count=len(items)
        )

    return items


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
        _refresh_fund_industry_tag(db, fund_code, fetch_holdings_if_missing=True)
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


def check_4433_rule(rank_1y, rank_2y, rank_3y, rank_5y, rank_6m, rank_3m):
    if rank_1y is None or rank_1y > 25:
        return False
    long_term_available = [r for r in [rank_2y, rank_3y] if r is not None]
    if long_term_available:
        for rank in long_term_available:
            if rank > 25:
                return False
    if rank_5y is not None and rank_5y > 25:
        return False
    if rank_6m is None or rank_6m > 33.33:
        return False
    return not (rank_3m is None or rank_3m > 33.33)


def calculate_same_type_rankings(db):
    fund_types = (
        db.query(FundBasicInfo.fund_type)
        .filter(FundBasicInfo.fund_type.isnot(None), FundBasicInfo.fund_type != "")
        .distinct()
        .all()
    )
    fund_types = [ft[0] for ft in fund_types]

    for fund_type in fund_types:
        funds = (
            db.query(FundBasicInfo)
            .filter(FundBasicInfo.fund_type == fund_type, FundBasicInfo.performance_json.isnot(None))
            .all()
        )
        if len(funds) < 2:
            continue

        fund_performances = []
        for fund in funds:
            perf = _json_loads(fund.performance_json, {})
            fund_performances.append(
                {
                    "fund_code": fund.fund_code,
                    "return_1m": perf.get("1_month_return"),
                    "return_3m": perf.get("3_month_return"),
                    "return_6m": perf.get("6_month_return"),
                    "return_1y": perf.get("1_year_return"),
                    "return_2y": perf.get("2_year_return"),
                    "return_3y": perf.get("3_year_return"),
                }
            )

        periods = [
            ("return_1m", "rank_pct_1m"),
            ("return_3m", "rank_pct_3m"),
            ("return_6m", "rank_pct_6m"),
            ("return_1y", "rank_pct_1y"),
            ("return_2y", "rank_pct_2y"),
            ("return_3y", "rank_pct_3y"),
        ]

        fund_ranks = {fp["fund_code"]: {} for fp in fund_performances}

        for return_field, rank_field in periods:

            def is_valid_return(val):
                if val is None:
                    return False
                try:
                    num_val = float(val)
                    return not abs(num_val) < 0.01
                except (ValueError, TypeError):
                    return False

            funds_with_data = [
                (fp["fund_code"], float(fp[return_field]))
                for fp in fund_performances
                if is_valid_return(fp[return_field])
            ]
            if len(funds_with_data) < 2:
                continue
            funds_with_data.sort(key=lambda x: x[1], reverse=True)
            total = len(funds_with_data)
            for rank_idx, (fund_code, _) in enumerate(funds_with_data, 1):
                fund_ranks[fund_code][rank_field] = round((rank_idx / total) * 100, 2)

        for fund_code, ranks in fund_ranks.items():
            rank_record = db.query(FundScreeningRank).filter(FundScreeningRank.fund_code == fund_code).first()
            if not rank_record:
                rank_record = FundScreeningRank(fund_code=fund_code)
                db.add(rank_record)
            for field, value in ranks.items():
                setattr(rank_record, field, value)
            rank_record.pass_4433 = (
                1
                if check_4433_rule(
                    ranks.get("rank_pct_1y"),
                    ranks.get("rank_pct_2y"),
                    ranks.get("rank_pct_3y"),
                    None,
                    ranks.get("rank_pct_6m"),
                    ranks.get("rank_pct_3m"),
                )
                else 0
            )
            rank_record.updated_time = datetime.now()

    db.commit()


def _create_data_fetch_task(db, task_type, options=None, message=""):
    task = DataFetchTask(
        task_type=task_type,
        status="running",
        target_count=0,
        current_count=0,
        success_count=0,
        fail_count=0,
        current_item="",
        message=message,
        options_json=_json_dumps(options or {}),
        started_time=datetime.now(),
        updated_time=datetime.now(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def _latest_active_task(db):
    return (
        db.query(DataFetchTask)
        .filter(DataFetchTask.task_type.in_(["screening_update", "fill_risk"]))
        .order_by(desc(DataFetchTask.started_time), desc(DataFetchTask.id))
        .first()
    )


def _is_active_task(task):
    if not task or task.status != "running":
        return False
    reference_time = task.updated_time or task.started_time
    if reference_time and datetime.now() - reference_time > timedelta(hours=1):
        task.status = "failed"
        task.error_message = "任务超过 6 小时未更新，已标记为陈旧任务"
        task.message = task.error_message
        task.finished_time = datetime.now()
        task.updated_time = datetime.now()
        return False
    return True


def _task_to_update_status(task):
    if not task:
        return {
            "running": screening_update_status.get("running", False),
            "progress": screening_update_status.get("progress", 0),
            "total": screening_update_status.get("total", 0),
            "current_fund": screening_update_status.get("current_fund", ""),
            "success_count": screening_update_status.get("success_count", 0),
            "fail_count": screening_update_status.get("fail_count", 0),
            "message": screening_update_status.get("message", ""),
        }
    result = {
        "task_id": task.id,
        "running": task.status == "running",
        "progress": task.current_count or 0,
        "total": task.target_count or 0,
        "current_fund": task.current_item or "",
        "success_count": task.success_count or 0,
        "fail_count": task.fail_count or 0,
        "message": task.message or "",
        "status": task.status,
        "started_time": task.started_time.isoformat() if task.started_time else None,
        "finished_time": task.finished_time.isoformat() if task.finished_time else None,
    }
    if task.status == "running":
        for mem_key, result_key in [
            ("progress", "progress"),
            ("total", "total"),
            ("current_fund", "current_fund"),
            ("success_count", "success_count"),
            ("fail_count", "fail_count"),
            ("message", "message"),
        ]:
            mem_val = screening_update_status.get(mem_key)
            if mem_val is not None and mem_val != "":
                result[result_key] = mem_val
    return result


def _set_screening_progress(db=None, task_id=None, **fields):
    key_map = {"current_count": "progress", "target_count": "total", "current_item": "current_fund"}
    for key, value in fields.items():
        memory_key = key_map.get(key, key)
        if memory_key in screening_update_status:
            screening_update_status[memory_key] = value

    if not db or not task_id:
        return

    task = db.query(DataFetchTask).filter(DataFetchTask.id == task_id).first()
    if not task:
        return
    for key, value in fields.items():
        if hasattr(task, key):
            setattr(task, key, value)
    if fields.get("status") in ("finished", "failed", "stopped"):
        task.finished_time = datetime.now()
    task.updated_time = datetime.now()
    db.commit()


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
            len(fund_list)
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
        missing_industry_codes = set(_fund_codes_needing_industry_refresh(db, all_basic_codes, force=False))
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
                ok = _refresh_fund_industry_tag(db, code, fetch_holdings_if_missing=True) is not None

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
