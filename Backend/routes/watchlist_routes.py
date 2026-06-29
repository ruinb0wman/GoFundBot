import json

from flask import Blueprint, jsonify, request

from core.logging import get_logger
from core.validation import validate_body
from database import SessionLocal
from database import get_request_db as get_db
from models import FundEstimate, FundTrend, FundWatchlist, FundWatchlistGroup
from schemas.watchlist_schemas import (
    AddWatchlistSchema,
    BatchDeleteSchema,
    CreateGroupSchema,
    MoveFundSchema,
    ReorderSchema,
)
from services.estimate_service import (
    _refresh_single_fund_estimate,
    _upsert_fund_estimate,
)
from services.helpers import (
    _estimate_is_after_nav,
    _normalize_date,
    _normalize_fund_code,
    _trend_daily_return,
    _value_to_string,
)

logger = get_logger(__name__)

watchlist_bp = Blueprint("watchlist", __name__, url_prefix="/api/watchlist")


@watchlist_bp.route("", methods=["GET"])
def get_watchlist():
    db = get_db()

    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("page_size", 200, type=int)
    page_size = min(max(page_size, 1), 200)

    groups = db.query(FundWatchlistGroup).order_by(FundWatchlistGroup.sort_order).all()
    total = db.query(FundWatchlist).count()
    query = db.query(FundWatchlist).order_by(FundWatchlist.sort_order)
    if page_size > 0:
        query = query.offset((page - 1) * page_size).limit(page_size)
    watchlist = query.all()

    groups_data = [{"id": g.id, "name": g.name, "sort_order": g.sort_order} for g in groups]

    funds_data = []
    for item in watchlist:
        estimate = db.query(FundEstimate).filter(FundEstimate.fund_code == item.fund_code).first()

        net_worth = estimate.net_worth if estimate else None
        net_worth_date = estimate.net_worth_date if estimate else None
        display_change = estimate.estimate_change if estimate else None

        try:
            trend = db.query(FundTrend).filter(FundTrend.fund_code == item.fund_code).first()
            if trend and trend.net_worth_trend_json:
                trend_data = json.loads(trend.net_worth_trend_json)
                if isinstance(trend_data, list) and trend_data:
                    last = trend_data[-1]
                    if isinstance(last, dict):
                        t_nw = last.get("net_worth")
                        t_date = last.get("date")
                        if t_nw is not None and t_date is not None:
                            trend_change = _trend_daily_return(trend_data)
                            if not net_worth_date or _normalize_date(t_date) >= _normalize_date(net_worth_date):
                                net_worth = str(t_nw)
                                net_worth_date = str(t_date)
                                if trend_change is not None and not _estimate_is_after_nav(
                                    estimate.estimate_time if estimate else None, t_date
                                ):
                                    display_change = _value_to_string(trend_change)
        except Exception:
            pass

        funds_data.append(
            {
                "fund_code": item.fund_code,
                "fund_name": item.fund_name,
                "fund_type": item.fund_type,
                "group_id": item.group_id,
                "sort_order": item.sort_order,
                "created_time": item.created_time.isoformat() if item.created_time else None,
                "net_worth": net_worth,
                "net_worth_date": net_worth_date,
                "estimate_value": estimate.estimate_value if estimate else None,
                "estimate_change": display_change,
                "estimate_time": estimate.estimate_time if estimate else None,
            }
        )

    return jsonify(
        {
            "groups": groups_data,
            "data": funds_data,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size) if page_size > 0 else 1,
        }
    )


@watchlist_bp.route("/<fund_code>", methods=["GET"])
def check_watchlist(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    db = get_db()
    exists = db.query(FundWatchlist).filter(FundWatchlist.fund_code == fund_code).first() is not None
    return jsonify({"in_watchlist": exists})


@watchlist_bp.route("", methods=["POST"])
@validate_body(AddWatchlistSchema)
def add_to_watchlist():
    data = request.get_json()
    fund_code = _normalize_fund_code(data.get("fund_code"))
    fund_name = data.get("fund_name", "")
    fund_type = data.get("fund_type", "")
    group_id = data.get("group_id")
    estimate_payload = data.get("estimate") if isinstance(data.get("estimate"), dict) else None

    if not fund_code:
        return jsonify({"error": "Fund code is required"}), 400

    db = get_db()
    existing = db.query(FundWatchlist).filter(FundWatchlist.fund_code == fund_code).first()
    if existing:
        return jsonify({"error": "Fund already in watchlist", "fund_code": fund_code}), 409

    query = db.query(FundWatchlist)
    if group_id:
        query = query.filter(FundWatchlist.group_id == group_id)
    max_order = query.order_by(FundWatchlist.sort_order.desc()).first()
    new_order = (max_order.sort_order + 1) if max_order else 0

    new_item = FundWatchlist(
        fund_code=fund_code, fund_name=fund_name, fund_type=fund_type, group_id=group_id, sort_order=new_order
    )

    try:
        db.add(new_item)
        estimate_result = None
        if estimate_payload:
            estimate_result = _upsert_fund_estimate(
                db,
                fund_code,
                name=estimate_payload.get("name") or fund_name,
                net_worth=_value_to_string(estimate_payload.get("net_worth")),
                net_worth_date=estimate_payload.get("net_worth_date"),
                estimate_value=_value_to_string(estimate_payload.get("estimate_value")),
                estimate_change=_value_to_string(estimate_payload.get("estimate_change")),
                estimate_time=estimate_payload.get("estimate_time"),
            )
        db.commit()
        if not estimate_result:
            try:
                estimate_db = SessionLocal()
                try:
                    estimate_result = _refresh_single_fund_estimate(estimate_db, fund_code)
                    estimate_db.commit()
                finally:
                    estimate_db.close()
            except Exception as estimate_exc:
                logger.error(f"add watchlist: initial estimate refresh failed for {fund_code}: {estimate_exc}")
        return jsonify(
            {
                "message": "Fund added to watchlist",
                "fund_code": fund_code,
                "sort_order": new_order,
                "estimate": estimate_result,
            }
        ), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@watchlist_bp.route("/<fund_code>", methods=["DELETE"])
def remove_from_watchlist(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    db = get_db()
    item = db.query(FundWatchlist).filter(FundWatchlist.fund_code == fund_code).first()
    if not item:
        return jsonify({"error": "Fund not in watchlist"}), 404
    try:
        db.delete(item)
        db.commit()
        return jsonify({"message": "Fund removed from watchlist", "fund_code": fund_code})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@watchlist_bp.route("/batch-delete", methods=["POST"])
@validate_body(BatchDeleteSchema)
def batch_delete_from_watchlist():
    data = request.get_json()
    fund_codes = [_normalize_fund_code(code) for code in data.get("fund_codes", [])]
    if not fund_codes:
        return jsonify({"error": "Fund codes are required"}), 400
    db = get_db()
    try:
        deleted_count = (
            db.query(FundWatchlist).filter(FundWatchlist.fund_code.in_(fund_codes)).delete(synchronize_session=False)
        )
        db.commit()
        return jsonify({"message": f"Deleted {deleted_count} funds from watchlist", "deleted_count": deleted_count})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@watchlist_bp.route("/reorder", methods=["PUT"])
@validate_body(ReorderSchema)
def reorder_watchlist():
    data = request.get_json()
    order = data.get("order", [])
    group_id = data.get("group_id")
    if not order:
        return jsonify({"error": "Order array is required"}), 400
    db = get_db()
    try:
        for index, fund_code in enumerate(order):
            fund_code = _normalize_fund_code(fund_code)
            update_data = {"sort_order": index}
            if group_id is not None:
                update_data["group_id"] = group_id if group_id > 0 else None
            db.query(FundWatchlist).filter(FundWatchlist.fund_code == fund_code).update(update_data)
        db.commit()
        return jsonify({"message": "Watchlist reordered successfully"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@watchlist_bp.route("/groups", methods=["GET"])
def get_groups():
    db = get_db()
    groups = db.query(FundWatchlistGroup).order_by(FundWatchlistGroup.sort_order).all()
    result = [{"id": g.id, "name": g.name, "sort_order": g.sort_order} for g in groups]
    return jsonify({"data": result})


@watchlist_bp.route("/groups", methods=["POST"])
@validate_body(CreateGroupSchema)
def create_group():
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Group name is required"}), 400
    db = get_db()
    max_order = db.query(FundWatchlistGroup).order_by(FundWatchlistGroup.sort_order.desc()).first()
    new_order = (max_order.sort_order + 1) if max_order else 0
    new_group = FundWatchlistGroup(name=name, sort_order=new_order)
    try:
        db.add(new_group)
        db.commit()
        return jsonify(
            {
                "message": "Group created",
                "group": {"id": new_group.id, "name": new_group.name, "sort_order": new_group.sort_order},
            }
        ), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@watchlist_bp.route("/groups/<int:group_id>", methods=["PUT"])
def update_group(group_id):
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Group name is required"}), 400
    db = get_db()
    group = db.query(FundWatchlistGroup).filter(FundWatchlistGroup.id == group_id).first()
    if not group:
        return jsonify({"error": "Group not found"}), 404
    try:
        group.name = name
        db.commit()
        return jsonify({"message": "Group updated", "group": {"id": group.id, "name": group.name}})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@watchlist_bp.route("/groups/<int:group_id>", methods=["DELETE"])
def delete_group(group_id):
    db = get_db()
    group = db.query(FundWatchlistGroup).filter(FundWatchlistGroup.id == group_id).first()
    if not group:
        return jsonify({"error": "Group not found"}), 404
    try:
        db.query(FundWatchlist).filter(FundWatchlist.group_id == group_id).update({"group_id": None})
        db.delete(group)
        db.commit()
        return jsonify({"message": "Group deleted"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@watchlist_bp.route("/groups/reorder", methods=["PUT"])
def reorder_groups():
    data = request.get_json()
    order = data.get("order", [])
    if not order:
        return jsonify({"error": "Order array is required"}), 400
    db = get_db()
    try:
        for index, group_id in enumerate(order):
            db.query(FundWatchlistGroup).filter(FundWatchlistGroup.id == group_id).update({"sort_order": index})
        db.commit()
        return jsonify({"message": "Groups reordered successfully"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@watchlist_bp.route("/move", methods=["PUT"])
@validate_body(MoveFundSchema)
def move_fund_to_group():
    data = request.get_json()
    fund_code = _normalize_fund_code(data.get("fund_code"))
    group_id = data.get("group_id")
    if not fund_code:
        return jsonify({"error": "Fund code is required"}), 400
    db = get_db()
    fund = db.query(FundWatchlist).filter(FundWatchlist.fund_code == fund_code).first()
    if not fund:
        return jsonify({"error": "Fund not in watchlist"}), 404
    try:
        fund.group_id = group_id if group_id and group_id > 0 else None
        db.commit()
        return jsonify({"message": "Fund moved successfully"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@watchlist_bp.route("/refresh-estimates", methods=["GET", "POST"])
def refresh_watchlist_estimates():
    db = get_db()
    watchlist = db.query(FundWatchlist).all()
    if not watchlist:
        return jsonify({"message": "Watchlist is empty", "updated": 0})

    fund_codes = [item.fund_code for item in watchlist]
    updated_count = 0
    failed_count = 0
    results = []

    for fund_code in fund_codes:
        try:
            result = _refresh_single_fund_estimate(db, fund_code)
            if result:
                updated_count += 1
                results.append(result)
            else:
                failed_count += 1
        except Exception as e:
            logger.error(f"刷新 {fund_code} 估值失败: {e}")
            failed_count += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500

    return jsonify(
        {
            "message": f"Updated {updated_count} funds",
            "updated": updated_count,
            "total": len(fund_codes),
            "failed": failed_count,
            "data": results,
        }
    )
