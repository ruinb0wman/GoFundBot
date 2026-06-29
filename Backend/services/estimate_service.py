import json
import re
from datetime import datetime

import requests

from core.logging import get_logger
from fund_api import FundAPI
from models import FundEstimate, FundTrend
from services.data_service_client import DataServiceClient, get_data_service_client
from services.helpers import (
    _estimate_is_after_nav,
    _json_dumps,
    _json_loads,
    _normalize_date,
    _trend_daily_return,
    _value_to_string,
)

logger = get_logger(__name__)

_fund_api = FundAPI()


def _apply_estimate_fields(rec, name, net_worth, net_worth_date, estimate_value, estimate_change, estimate_time):
    if name is not None:
        rec.name = name
    if net_worth_date is not None and (
        not rec.net_worth_date or _normalize_date(net_worth_date) >= _normalize_date(rec.net_worth_date)
    ):
        if net_worth is not None:
            rec.net_worth = net_worth
        rec.net_worth_date = net_worth_date
    if estimate_value is not None:
        rec.estimate_value = estimate_value
    if estimate_change is not None:
        rec.estimate_change = estimate_change
    if estimate_time is not None:
        rec.estimate_time = estimate_time


def _upsert_fund_estimate(
    db,
    fund_code,
    name=None,
    net_worth=None,
    net_worth_date=None,
    estimate_value=None,
    estimate_change=None,
    estimate_time=None,
):
    estimate_record = db.query(FundEstimate).filter(FundEstimate.fund_code == fund_code).first()

    if estimate_record:
        _apply_estimate_fields(
            estimate_record, name, net_worth, net_worth_date, estimate_value, estimate_change, estimate_time
        )
    else:
        estimate_record = FundEstimate(
            fund_code=fund_code,
            name=name,
            net_worth=net_worth,
            net_worth_date=net_worth_date,
            estimate_value=estimate_value,
            estimate_change=estimate_change,
            estimate_time=estimate_time,
        )
        db.add(estimate_record)
        try:
            db.flush()
        except Exception:
            db.rollback()
            existing = db.query(FundEstimate).filter(FundEstimate.fund_code == fund_code).first()
            if existing:
                _apply_estimate_fields(
                    existing, name, net_worth, net_worth_date, estimate_value, estimate_change, estimate_time
                )
                estimate_record = existing
            else:
                db.add(estimate_record)

    return {
        "fund_code": fund_code,
        "estimate_value": estimate_value,
        "estimate_change": estimate_change,
        "estimate_time": estimate_time,
        "net_worth": net_worth,
        "net_worth_date": net_worth_date,
    }


def _upsert_data_service_estimate(db, fund_code, estimate_data):
    return _upsert_fund_estimate(
        db,
        fund_code,
        name=estimate_data.get("name"),
        net_worth=_value_to_string(estimate_data.get("nav")),
        net_worth_date=estimate_data.get("navDate"),
        estimate_value=_value_to_string(estimate_data.get("estimatedNav")),
        estimate_change=_value_to_string(estimate_data.get("estimatedChangePercent")),
        estimate_time=estimate_data.get("estimateTime"),
    )


def _latest_nav_from_data_service(fund_code):
    from services.risk_metrics import _nav_history_payload_items

    payload = get_data_service_client().get_fund_nav_history(fund_code)
    items = _nav_history_payload_items(payload)
    latest = None
    for item in items:
        if not isinstance(item, dict):
            continue
        date = item.get("date")
        nav = item.get("nav")
        if not date or nav is None:
            continue
        if latest is None or _normalize_date(date) > _normalize_date(latest.get("date")):
            latest = item
    if not latest:
        return None
    return {
        "date": str(latest.get("date")),
        "nav": latest.get("nav"),
        "daily_return": latest.get("dailyReturn"),
    }


def _latest_nav_from_fund_trend(db, fund_code):
    trend = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
    rows = _json_loads(trend.net_worth_trend_json, []) if trend else []
    if not isinstance(rows, list) or not rows:
        return None

    normalized = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        date = row.get("date")
        nav = row.get("net_worth")
        if date is None or nav is None:
            continue
        normalized.append(row)
    if not normalized:
        return None

    normalized.sort(key=lambda item: _normalize_date(item.get("date")))
    latest = normalized[-1]
    daily_return = _trend_daily_return(normalized)

    return {
        "date": str(latest.get("date")),
        "nav": latest.get("net_worth"),
        "daily_return": daily_return,
    }


def _refresh_fund_detail_estimate_snapshot(db, fund_code, result=None):
    try:
        raw_data = _fund_api._fetch_raw_data(fund_code)
    except Exception as exc:
        logger.error(f"refresh detail snapshot: failed for {fund_code}: {exc}")
        return result

    if not raw_data:
        return result

    trend_rows = _fund_api.cleaner.clean_array_data(raw_data.get("Data_netWorthTrend"), "net_worth")
    if trend_rows:
        trend_record = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
        if trend_record:
            trend_record.net_worth_trend_json = _json_dumps(trend_rows)
            trend_record.updated_time = datetime.now()
        else:
            db.add(
                FundTrend(
                    fund_code=fund_code,
                    net_worth_trend_json=_json_dumps(trend_rows),
                    accumulated_net_worth_json=_json_dumps([]),
                    position_trend_json=_json_dumps([]),
                    total_return_trend_json=_json_dumps([]),
                    ranking_trend_json=_json_dumps([]),
                    ranking_percentage_json=_json_dumps([]),
                    scale_fluctuation_json=_json_dumps({}),
                )
            )

    latest_nav = trend_rows[-1] if trend_rows else {}
    fundgz_nav = raw_data.get("dwjz")
    fundgz_date = raw_data.get("jzrq")
    net_worth = fundgz_nav
    net_worth_date = fundgz_date
    if latest_nav:
        trend_nav = latest_nav.get("net_worth")
        trend_date = latest_nav.get("date")
        if trend_nav is not None and trend_date is not None:
            if not fundgz_date or _normalize_date(trend_date) > _normalize_date(fundgz_date):
                net_worth = trend_nav
                net_worth_date = trend_date

    result = _upsert_fund_estimate(
        db,
        fund_code,
        name=raw_data.get("name") or raw_data.get("fS_name"),
        net_worth=_value_to_string(net_worth),
        net_worth_date=net_worth_date,
        estimate_value=_value_to_string(raw_data.get("gsz")),
        estimate_change=_value_to_string(raw_data.get("gszzl")),
        estimate_time=raw_data.get("gztime"),
    )

    return _sync_latest_official_nav(db, fund_code, result)


def _sync_latest_official_nav(db, fund_code, result=None):
    candidates = []
    try:
        latest_ds = _latest_nav_from_data_service(fund_code)
        if latest_ds:
            latest_ds["source"] = "data_service_nav"
            candidates.append(latest_ds)
    except Exception as exc:
        logger.error(f"sync official nav: DataService unavailable for {fund_code}: {exc}")

    latest_trend = _latest_nav_from_fund_trend(db, fund_code)
    if latest_trend:
        latest_trend["source"] = "fund_trend"
        candidates.append(latest_trend)

    latest = None
    for item in candidates:
        if not item.get("date"):
            continue
        if latest is None or _normalize_date(item.get("date")) > _normalize_date(latest.get("date")):
            latest = item
    if not latest:
        return result

    estimate = db.query(FundEstimate).filter(FundEstimate.fund_code == fund_code).first()
    if not estimate:
        estimate = FundEstimate(fund_code=fund_code)
        db.add(estimate)

    latest_date = latest.get("date")
    current_date = estimate.net_worth_date
    if latest_date and (not current_date or _normalize_date(latest_date) >= _normalize_date(current_date)):
        latest_nav = _value_to_string(latest.get("nav"))
        if latest_nav is not None:
            estimate.net_worth = latest_nav
        estimate.net_worth_date = latest_date
        has_newer_intraday_estimate = _estimate_is_after_nav(estimate.estimate_time, latest_date)
        if latest.get("daily_return") is not None and not has_newer_intraday_estimate:
            estimate.estimate_change = _value_to_string(latest.get("daily_return"))

        if isinstance(result, dict):
            result["net_worth"] = estimate.net_worth
            result["net_worth_date"] = estimate.net_worth_date
            if not has_newer_intraday_estimate:
                result["estimate_change"] = estimate.estimate_change
            result["official_nav_synced"] = True

    return result


def _refresh_fundgz_estimate(db, fund_code):
    real_time_url = f"http://fundgz.1234567.com.cn/js/{fund_code}.js"
    response = requests.get(
        real_time_url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
        timeout=1.5,
    )

    if response.status_code != 200:
        return None

    match = re.search(r"jsonpgz\((.*?)\);", response.text)
    if not match:
        return None

    rt_data = json.loads(match.group(1))
    if not rt_data:
        return None

    net_worth = rt_data.get("dwjz")
    net_worth_date = rt_data.get("jzrq")

    try:
        trend = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
        if trend and trend.net_worth_trend_json:
            trend_data = json.loads(trend.net_worth_trend_json)
            if isinstance(trend_data, list) and trend_data:
                last = trend_data[-1]
                if isinstance(last, dict):
                    t_nw = last.get("net_worth")
                    t_date = last.get("date")
                    if t_nw is not None and t_date is not None:
                        if not net_worth_date or _normalize_date(t_date) > _normalize_date(net_worth_date):
                            net_worth = str(t_nw)
                            net_worth_date = str(t_date)
    except Exception:
        pass

    return _upsert_fund_estimate(
        db,
        fund_code,
        name=rt_data.get("name"),
        net_worth=net_worth,
        net_worth_date=net_worth_date,
        estimate_value=rt_data.get("gsz"),
        estimate_change=rt_data.get("gszzl"),
        estimate_time=rt_data.get("gztime"),
    )


def _refresh_single_fund_estimate(db, fund_code):
    result = None
    try:
        payload = DataServiceClient(timeout=1.5).get_fund_estimates([fund_code])
        ds_data = payload.get("data", {}) if isinstance(payload, dict) else {}
        for item in ds_data.get("items", []) if isinstance(ds_data, dict) else []:
            if isinstance(item, dict) and item.get("code") == fund_code and isinstance(item.get("data"), dict):
                result = _upsert_data_service_estimate(db, fund_code, item["data"])
                break
    except Exception as exc:
        logger.error(f"refresh single estimate: DataService unavailable for {fund_code}: {exc}")

    detail_result = _refresh_fund_detail_estimate_snapshot(db, fund_code, result)
    if detail_result:
        return detail_result

    try:
        result = _refresh_fundgz_estimate(db, fund_code)
        if result:
            return _sync_latest_official_nav(db, fund_code, result)
    except Exception as exc:
        logger.error(f"refresh single estimate: fundgz failed for {fund_code}: {exc}")

    latest = _latest_nav_from_fund_trend(db, fund_code)
    if latest:
        return _sync_latest_official_nav(
            db,
            fund_code,
            {
                "fund_code": fund_code,
                "estimate_value": None,
                "estimate_change": None,
                "estimate_time": None,
                "net_worth": _value_to_string(latest.get("nav")),
                "net_worth_date": latest.get("date"),
            },
        )

    existing = db.query(FundEstimate).filter(FundEstimate.fund_code == fund_code).first()
    if existing:
        logger.warning(f"refresh single estimate: reusing cached estimate for {fund_code}")
        return {
            "fund_code": fund_code,
            "estimate_value": existing.estimate_value,
            "estimate_change": existing.estimate_change,
            "estimate_time": existing.estimate_time,
            "net_worth": existing.net_worth,
            "net_worth_date": existing.net_worth_date,
        }
    return None
