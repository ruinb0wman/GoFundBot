import json

from flask import jsonify, request

from core.logging import get_logger
from core.validation import validate_body
from database import get_request_db as get_db
from models import UserFundGroupMap, UserFundPortfolio, UserTradeRecord
from schemas.user_portfolio_schemas import (
    FundPortfolioBatchCreateSchema,
    FundPortfolioCreateSchema,
    FundPortfolioReorderSchema,
)

from . import user_portfolio_bp

logger = get_logger(__name__)

# ──────────────────────────────────────────────
# Fund Portfolio
# ──────────────────────────────────────────────


@user_portfolio_bp.route("/funds", methods=["GET"])
def list_funds():
    db = get_db()
    items = db.query(UserFundPortfolio).order_by(UserFundPortfolio.sort_order).all()
    return jsonify(
        [
            {
                "fund_code": f.fund_code,
                "fund_name": f.fund_name,
                "fund_type": f.fund_type,
                "fund_data_json": json.loads(f.fund_data_json) if f.fund_data_json else None,
                "sort_order": f.sort_order,
            }
            for f in items
        ]
    )


@user_portfolio_bp.route("/funds", methods=["POST"])
@validate_body(FundPortfolioCreateSchema)
def add_fund():
    data = request.get_json()
    db = get_db()
    fund_code = data["fund_code"]
    existing = db.query(UserFundPortfolio).filter(UserFundPortfolio.fund_code == fund_code).first()
    if existing:
        return jsonify({"error": "该基金已在自选中", "fund_code": fund_code}), 409
    try:
        max_order = db.query(UserFundPortfolio).count()
        item = UserFundPortfolio(
            fund_code=fund_code,
            fund_name=data.get("fund_name", ""),
            fund_type=data.get("fund_type", ""),
            fund_data_json=json.dumps(data.get("fund_data_json", {}), ensure_ascii=False)
            if data.get("fund_data_json")
            else None,
            sort_order=data.get("sort_order", max_order),
        )
        db.add(item)
        db.commit()
        return jsonify({"status": "ok", "fund_code": fund_code}), 201
    except Exception as e:
        db.rollback()
        logger.error(f"添加自选基金失败 {fund_code}", extra={"error": str(e)})
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/funds/batch", methods=["POST"])
@validate_body(FundPortfolioBatchCreateSchema)
def batch_add_funds():
    data = request.get_json()
    db = get_db()
    results = {"added": [], "skipped": []}
    try:
        for f in data["funds"]:
            code = f["fund_code"]
            existing = db.query(UserFundPortfolio).filter(UserFundPortfolio.fund_code == code).first()
            if existing:
                results["skipped"].append(code)
                continue
            item = UserFundPortfolio(
                fund_code=code,
                fund_name=f.get("fund_name", ""),
                fund_type=f.get("fund_type", ""),
                fund_data_json=json.dumps(f.get("fund_data_json", {}), ensure_ascii=False)
                if f.get("fund_data_json")
                else None,
                sort_order=f.get("sort_order", 0),
            )
            db.add(item)
            results["added"].append(code)
        db.commit()
        return jsonify(results), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/funds/<fund_code>", methods=["DELETE"])
def remove_fund(fund_code):
    db = get_db()
    item = db.query(UserFundPortfolio).filter(UserFundPortfolio.fund_code == fund_code).first()
    if not item:
        return jsonify({"error": "基金不在自选中"}), 404
    try:
        db.delete(item)
        db.query(UserFundGroupMap).filter(UserFundGroupMap.fund_code == fund_code).delete()
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/funds/reorder", methods=["PUT"])
@validate_body(FundPortfolioReorderSchema)
def reorder_funds():
    data = request.get_json()
    db = get_db()
    try:
        for idx, code in enumerate(data["fund_codes"]):
            db.query(UserFundPortfolio).filter(UserFundPortfolio.fund_code == code).update({"sort_order": idx})
        db.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


@user_portfolio_bp.route("/funds/all", methods=["PUT"])
def update_all_funds():
    data = request.get_json(silent=True) or {}
    funds = data.get("funds", [])
    db = get_db()
    try:
        db.query(UserFundPortfolio).delete()
        for idx, f in enumerate(funds):
            code = f.get("fund_code") or f.get("code")
            if not code:
                continue
            item = UserFundPortfolio(
                fund_code=code,
                fund_name=f.get("fund_name") or f.get("name", ""),
                fund_type=f.get("fund_type", ""),
                fund_data_json=json.dumps(f, ensure_ascii=False) if isinstance(f, dict) else None,
                sort_order=idx,
            )
            db.add(item)
        db.commit()
        return jsonify({"status": "ok", "count": len(funds)})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500


# ──────────────────────────────────────────────
# Holdings (computed from trade records)
# ──────────────────────────────────────────────


@user_portfolio_bp.route("/holdings", methods=["GET"])
def list_holdings():
    db = get_db()
    as_of = request.args.get("as_of")
    query = db.query(UserTradeRecord).filter(UserTradeRecord.status == "settled")
    if as_of:
        query = query.filter(UserTradeRecord.trade_date <= as_of)
    trades = query.order_by(UserTradeRecord.trade_date).all()

    result = {}
    for t in trades:
        code = t.fund_code
        if code not in result:
            result[code] = {"share": 0, "buy_amount": 0, "buy_shares": 0, "buy_date": "", "total_fee": 0}
        r = result[code]
        if t.type == "buy":
            r["buy_amount"] += t.amount
            r["buy_shares"] += t.share
            r["share"] += t.share
            if not r["buy_date"] or (t.trade_date and t.trade_date < r["buy_date"]):
                r["buy_date"] = t.trade_date
        elif t.type == "sell":
            r["share"] -= t.share
        elif t.type == "dividend":
            r["buy_amount"] += t.amount
            r["buy_shares"] += t.share
            r["share"] += t.share
        elif t.type == "fee":
            r["total_fee"] += t.amount

    for code, r in result.items():
        r["cost"] = round(r["buy_amount"] / r["buy_shares"], 4) if r["buy_shares"] > 0 else 0
        if r["share"] <= 0.001:
            r["share"] = 0
            r["cost"] = 0
        del r["buy_amount"], r["buy_shares"]

    return jsonify(result)
