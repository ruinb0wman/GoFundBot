import contextlib
import time
from datetime import datetime, timedelta

from sqlalchemy import desc

from core.logging import get_logger
from models import DataFetchTask, FundBasicInfo, FundRiskMetrics
from services.data_service_client import DataServiceError, get_data_service_client
from services.helpers import _json_dumps, _normalize_fund_code

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

    from services.fund_industry import _refresh_fund_industry_tag

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


from .rankings import calculate_same_type_rankings, check_4433_rule  # noqa: E402, F401
from .tasks import (  # noqa: E402, F401
    _select_nav_candidates,
    batch_fill_risk_metrics,
    batch_update_fund_data,
    update_single_fund_risk_metrics,
)
