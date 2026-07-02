import json

from flask import jsonify, request
from sqlalchemy import desc

from core.logging import get_logger
from core.validation import validate_body
from database import get_request_db as get_db
from models import (
    UserFundGroupMap,
    UserFundHolding,
    UserFundPortfolio,
    UserPortfolioGroup,
    UserPosition,
    UserTradeRecord,
)
from schemas.user_portfolio_schemas import MigratePayloadSchema

from . import user_portfolio_bp

logger = get_logger(__name__)


@user_portfolio_bp.route("/migrate", methods=["POST"])
@validate_body(MigratePayloadSchema)
def migrate_from_localstorage():
    data = request.get_json()
    db = get_db()
    try:
        seen_txn_ids = set()
        funds = data.get("funds", [])
        fund_order = data.get("fundOrder", [])
        order_map = {code: idx for idx, code in enumerate(fund_order)} if fund_order else {}

        for idx, f in enumerate(funds):
            code = f.get("code") or f.get("fund_code") or ""
            if not code:
                continue
            if db.query(UserFundPortfolio).filter(UserFundPortfolio.fund_code == code).first():
                continue
            so = order_map.get(code, idx)
            db.add(
                UserFundPortfolio(
                    fund_code=code,
                    fund_name=f.get("name") or f.get("fund_name", ""),
                    fund_type=f.get("type") or f.get("fund_type", ""),
                    fund_data_json=json.dumps(f, ensure_ascii=False) if isinstance(f, dict) else None,
                    sort_order=so,
                )
            )

        holdings = data.get("holdings", {})
        for code, h in holdings.items():
            if db.query(UserFundHolding).filter(UserFundHolding.fund_code == code).first():
                continue
            db.add(
                UserFundHolding(
                    fund_code=code,
                    share=h.get("share", 0),
                    cost=h.get("cost", 0),
                    buy_date=h.get("buy_date", ""),
                    profit=h.get("profit", 0),
                    profit_nav_date=h.get("profit_nav_date", ""),
                )
            )

        for t in data.get("tradeRecords", []):
            tid = t.get("txn_id", "") or t.get("id", "")
            if tid and tid in seen_txn_ids:
                continue
            if tid:
                seen_txn_ids.add(tid)
            db.add(
                UserTradeRecord(
                    fund_code=t.get("fund_code") or t.get("fundCode", ""),
                    fund_name=t.get("fund_name") or t.get("fundName", ""),
                    type=t.get("type", ""),
                    trade_date=t.get("trade_date") or t.get("tradeDate", ""),
                    amount=t.get("amount", 0),
                    share=t.get("share", 0),
                    nav=t.get("nav", 0),
                    status=t.get("status", "settled"),
                    txn_id=tid,
                    settled_at=t.get("settled_at") or t.get("settledAt", ""),
                )
            )

        for t in data.get("pendingTxns", []):
            tid = t.get("id", "") or t.get("txn_id", "")
            if tid and tid in seen_txn_ids:
                continue
            if tid:
                seen_txn_ids.add(tid)
            db.add(
                UserTradeRecord(
                    fund_code=t.get("fund_code") or t.get("fundCode", ""),
                    fund_name=t.get("fund_name") or t.get("fundName", ""),
                    type=t.get("type", ""),
                    trade_date=t.get("trade_date") or t.get("tradeDate", ""),
                    amount=t.get("inputValue", 0),
                    share=0,
                    nav=t.get("nav", 0),
                    status="pending",
                    txn_id=tid,
                )
            )

        for g in data.get("groups", []):
            gid = g.get("id")
            name = g.get("name", "")
            if isinstance(gid, str) and gid.startswith("g_"):
                new_g = UserPortfolioGroup(name=name)
                db.add(new_g)
                db.flush()
                old_group_map = data.get("groupMap", {})
                for fcode, old_gid in old_group_map.items():
                    if old_gid == gid:
                        existing = db.query(UserFundGroupMap).filter(UserFundGroupMap.fund_code == fcode).first()
                        if existing:
                            existing.group_id = new_g.id
                        else:
                            db.add(UserFundGroupMap(fund_code=fcode, group_id=new_g.id))
            elif isinstance(gid, int):
                if not db.query(UserPortfolioGroup).filter(UserPortfolioGroup.id == gid).first():
                    db.add(UserPortfolioGroup(id=gid, name=name))

        group_map = data.get("groupMap", {})
        for code, gid in group_map.items():
            if isinstance(gid, str) and gid.startswith("g_"):
                continue
            if not db.query(UserFundGroupMap).filter(UserFundGroupMap.fund_code == code).first():
                db.add(
                    UserFundGroupMap(
                        fund_code=code,
                        group_id=int(gid) if gid and str(gid).isdigit() else None,
                    )
                )

        for p in data.get("positions", []):
            db.add(
                UserPosition(
                    fund_code=p.get("code") or p.get("fund_code", ""),
                    fund_name=p.get("name") or p.get("fund_name", ""),
                    purchase_date=p.get("purchaseDate") or p.get("purchase_date", ""),
                    purchase_time=p.get("purchaseTime") or p.get("purchase_time", ""),
                    shares=p.get("shares", 0),
                    cost=p.get("cost", 0),
                )
            )

        db.commit()
        return jsonify({"status": "ok", "message": "数据迁移成功"})
    except Exception as e:
        db.rollback()
        logger.error("迁移失败", extra={"error": str(e)})
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/export", methods=["GET"])
def export_all():
    db = get_db()

    funds = db.query(UserFundPortfolio).order_by(UserFundPortfolio.sort_order).all()
    holdings = db.query(UserFundHolding).all()
    trades = db.query(UserTradeRecord).order_by(desc(UserTradeRecord.created_time)).all()
    groups = db.query(UserPortfolioGroup).order_by(UserPortfolioGroup.sort_order).all()
    group_map = db.query(UserFundGroupMap).all()
    positions = db.query(UserPosition).order_by(desc(UserPosition.created_time)).all()

    result = {
        "funds": [
            {
                "code": f.fund_code,
                "name": f.fund_name,
                "type": f.fund_type,
                "sort_order": f.sort_order,
                "data": json.loads(f.fund_data_json) if f.fund_data_json else None,
            }
            for f in funds
        ],
        "holdings": {
            h.fund_code: {
                "share": h.share,
                "cost": h.cost,
                "buy_date": h.buy_date,
                "profit": h.profit,
                "profit_nav_date": h.profit_nav_date,
            }
            for h in holdings
        },
        "tradeRecords": [
            {
                "id": t.id,
                "fund_code": t.fund_code,
                "fund_name": t.fund_name,
                "type": t.type,
                "trade_date": t.trade_date,
                "amount": t.amount,
                "share": t.share,
                "nav": t.nav,
                "status": t.status,
                "txn_id": t.txn_id,
                "settled_at": t.settled_at,
            }
            for t in trades
        ],
        "groups": [{"id": g.id, "name": g.name} for g in groups],
        "groupMap": {m.fund_code: str(m.group_id) if m.group_id is not None else None for m in group_map},
        "positions": [
            {
                "id": p.id,
                "fund_code": p.fund_code,
                "fund_name": p.fund_name,
                "purchase_date": p.purchase_date,
                "purchase_time": p.purchase_time,
                "shares": p.shares,
                "cost": p.cost,
            }
            for p in positions
        ],
    }
    return jsonify(result)
