from datetime import datetime

from flask import jsonify, request
from sqlalchemy import desc

from core.logging import get_logger
from core.validation import validate_body
from database import get_request_db as get_db
from models import UserTradeRecord
from schemas.user_portfolio_schemas import (
    BatchSettleSchema,
    TradeRecordCreateSchema,
    TradeRecordUpdateSchema,
)

from . import user_portfolio_bp

logger = get_logger(__name__)


@user_portfolio_bp.route("/trades", methods=["GET"])
def list_trades():
    fund_code = request.args.get("fund_code")
    db = get_db()
    q = db.query(UserTradeRecord).order_by(desc(UserTradeRecord.created_time))
    if fund_code:
        q = q.filter(UserTradeRecord.fund_code == fund_code)
    items = q.all()
    return jsonify(
        [
            {
                "id": r.id,
                "fund_code": r.fund_code,
                "fund_name": r.fund_name,
                "type": r.type,
                "trade_date": r.trade_date or "",
                "amount": r.amount,
                "share": r.share,
                "nav": r.nav,
                "status": r.status,
                "txn_id": r.txn_id or "",
                "settled_at": r.settled_at or "",
                "created_at": r.created_time.isoformat() if r.created_time else "",
            }
            for r in items
        ]
    )


@user_portfolio_bp.route("/trades", methods=["POST"])
@validate_body(TradeRecordCreateSchema)
def create_trade():
    data = request.get_json()
    db = get_db()
    try:
        r = UserTradeRecord(
            fund_code=data["fund_code"],
            fund_name=data.get("fund_name", ""),
            type=data["type"],
            trade_date=data.get("trade_date", ""),
            amount=data.get("amount", 0),
            share=data.get("share", 0),
            nav=data.get("nav", 0),
            status=data.get("status", "settled"),
            txn_id=data.get("txn_id", ""),
            settled_at=data.get("settled_at", ""),
        )
        db.add(r)
        db.commit()
        return jsonify({"status": "ok", "id": r.id}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/trades/<int:trade_id>", methods=["PUT"])
@validate_body(TradeRecordUpdateSchema)
def update_trade(trade_id):
    data = request.get_json()
    db = get_db()
    r = db.query(UserTradeRecord).filter(UserTradeRecord.id == trade_id).first()
    if not r:
        return jsonify({"error": "交易记录不存在"}), 404
    try:
        if "status" in data and data["status"] is not None:
            r.status = data["status"]
        if "settled_at" in data and data["settled_at"] is not None:
            r.settled_at = data["settled_at"]
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/trades/<int:trade_id>", methods=["DELETE"])
def delete_trade(trade_id):
    db = get_db()
    r = db.query(UserTradeRecord).filter(UserTradeRecord.id == trade_id).first()
    if not r:
        return jsonify({"error": "交易记录不存在"}), 404
    try:
        db.delete(r)
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/trades/pending/<txn_id>", methods=["DELETE"])
def delete_pending_trade(txn_id):
    db = get_db()
    r = db.query(UserTradeRecord).filter(UserTradeRecord.txn_id == txn_id).first()
    if not r:
        return jsonify({"error": "挂起记录不存在"}), 404
    try:
        db.delete(r)
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/trades/batch-settle", methods=["POST"])
@validate_body(BatchSettleSchema)
def batch_settle_trades():
    data = request.get_json()
    db = get_db()
    try:
        now = datetime.now().isoformat()
        updated = (
            db.query(UserTradeRecord)
            .filter(UserTradeRecord.txn_id.in_(data["txn_ids"]))
            .update({"status": "settled", "settled_at": now}, synchronize_session=False)
        )
        db.commit()
        return jsonify({"status": "ok", "updated": updated})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/trades", methods=["DELETE"])
def clear_trades():
    db = get_db()
    try:
        count = db.query(UserTradeRecord).delete()
        db.commit()
        return jsonify({"status": "ok", "deleted": count})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
