from datetime import datetime

from flask import jsonify, request
from sqlalchemy import desc

from core.logging import get_logger
from core.validation import validate_body
from database import get_request_db as get_db
from models import UserFundGroupMap, UserPortfolioGroup, UserPosition
from schemas.user_portfolio_schemas import (
    FundGroupMapUpdateSchema,
    PortfolioGroupCreateSchema,
    PortfolioGroupUpdateSchema,
    PositionCreateSchema,
    PositionUpdateSchema,
)

from . import user_portfolio_bp

logger = get_logger(__name__)

# ──────────────────────────────────────────────
# Portfolio Groups
# ──────────────────────────────────────────────


@user_portfolio_bp.route("/groups", methods=["GET"])
def list_groups():
    db = get_db()
    items = db.query(UserPortfolioGroup).order_by(UserPortfolioGroup.sort_order).all()
    return jsonify([{"id": g.id, "name": g.name, "sort_order": g.sort_order} for g in items])


@user_portfolio_bp.route("/groups", methods=["POST"])
@validate_body(PortfolioGroupCreateSchema)
def create_group():
    data = request.get_json()
    db = get_db()
    try:
        max_order = db.query(UserPortfolioGroup).count()
        g = UserPortfolioGroup(name=data["name"], sort_order=max_order)
        db.add(g)
        db.commit()
        return jsonify({"status": "ok", "id": g.id}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/groups/<int:group_id>", methods=["PUT"])
@validate_body(PortfolioGroupUpdateSchema)
def update_group(group_id):
    data = request.get_json()
    db = get_db()
    g = db.query(UserPortfolioGroup).filter(UserPortfolioGroup.id == group_id).first()
    if not g:
        return jsonify({"error": "分组不存在"}), 404
    try:
        if "name" in data and data["name"] is not None:
            g.name = data["name"]
        g.updated_time = datetime.now()
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/groups/<int:group_id>", methods=["DELETE"])
def delete_group(group_id):
    db = get_db()
    g = db.query(UserPortfolioGroup).filter(UserPortfolioGroup.id == group_id).first()
    if not g:
        return jsonify({"error": "分组不存在"}), 404
    try:
        db.delete(g)
        db.query(UserFundGroupMap).filter(UserFundGroupMap.group_id == group_id).delete()
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


# ──────────────────────────────────────────────
# Fund ↔ Group Map
# ──────────────────────────────────────────────


@user_portfolio_bp.route("/fund-group-map", methods=["GET"])
def get_group_map():
    db = get_db()
    items = db.query(UserFundGroupMap).all()
    result = {}
    for m in items:
        result[m.fund_code] = str(m.group_id) if m.group_id is not None else None
    return jsonify(result)


@user_portfolio_bp.route("/fund-group-map", methods=["PUT"])
@validate_body(FundGroupMapUpdateSchema)
def update_group_map():
    data = request.get_json()
    db = get_db()
    try:
        db.query(UserFundGroupMap).delete()
        for mapping in data["mappings"]:
            code = mapping.get("fund_code")
            gid = mapping.get("group_id")
            if not code:
                continue
            m = UserFundGroupMap(
                fund_code=code,
                group_id=int(gid) if gid is not None else None,
            )
            db.add(m)
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


# ──────────────────────────────────────────────
# Positions (MyPositions)
# ──────────────────────────────────────────────


@user_portfolio_bp.route("/positions", methods=["GET"])
def list_positions():
    db = get_db()
    items = db.query(UserPosition).order_by(desc(UserPosition.created_time)).all()
    return jsonify(
        [
            {
                "id": p.id,
                "fund_code": p.fund_code,
                "fund_name": p.fund_name,
                "purchase_date": p.purchase_date or "",
                "purchase_time": p.purchase_time or "",
                "shares": p.shares,
                "cost": p.cost,
            }
            for p in items
        ]
    )


@user_portfolio_bp.route("/positions", methods=["POST"])
@validate_body(PositionCreateSchema)
def create_position():
    data = request.get_json()
    db = get_db()
    try:
        p = UserPosition(
            fund_code=data["fund_code"],
            fund_name=data.get("fund_name", ""),
            purchase_date=data.get("purchase_date", ""),
            purchase_time=data.get("purchase_time", ""),
            shares=data.get("shares", 0),
            cost=data.get("cost", 0),
        )
        db.add(p)
        db.commit()
        return jsonify({"status": "ok", "id": p.id}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/positions/<int:position_id>", methods=["PUT"])
@validate_body(PositionUpdateSchema)
def update_position(position_id):
    data = request.get_json()
    db = get_db()
    p = db.query(UserPosition).filter(UserPosition.id == position_id).first()
    if not p:
        return jsonify({"error": "持仓不存在"}), 404
    try:
        if "fund_code" in data and data["fund_code"] is not None:
            p.fund_code = data["fund_code"]
        if "fund_name" in data and data["fund_name"] is not None:
            p.fund_name = data["fund_name"]
        if "purchase_date" in data and data["purchase_date"] is not None:
            p.purchase_date = data["purchase_date"]
        if "purchase_time" in data and data["purchase_time"] is not None:
            p.purchase_time = data["purchase_time"]
        if "shares" in data and data["shares"] is not None:
            p.shares = data["shares"]
        if "cost" in data and data["cost"] is not None:
            p.cost = data["cost"]
        p.updated_time = datetime.now()
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/positions/<int:position_id>", methods=["DELETE"])
def delete_position(position_id):
    db = get_db()
    p = db.query(UserPosition).filter(UserPosition.id == position_id).first()
    if not p:
        return jsonify({"error": "持仓不存在"}), 404
    try:
        db.delete(p)
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/positions", methods=["DELETE"])
def clear_positions():
    db = get_db()
    try:
        count = db.query(UserPosition).delete()
        db.commit()
        return jsonify({"status": "ok", "deleted": count})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
