from datetime import datetime

from models import FundPortfolio
from services.helpers import _json_dumps
from services.stock_utils import _normalize_stock_code


def _save_portfolio_from_holdings_payload(db, fund_code, payload):
    data = payload.get("data", {}) if isinstance(payload, dict) else {}
    items = data.get("items", []) if isinstance(data, dict) else []
    if not isinstance(items, list) or not items:
        return None

    stock_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        code = _normalize_stock_code(item.get("stockCode") or item.get("code"))
        if not code:
            continue
        ratio = item.get("ratio")
        if isinstance(ratio, (int, float)) and 0 < ratio <= 1:
            ratio = round(ratio * 100, 4)
        stock_items.append(
            {
                "code": code,
                "name": item.get("stockName") or item.get("name") or code,
                "market": item.get("market"),
                "ratio": ratio,
            }
        )

    if not stock_items:
        return None

    from services.helpers import _normalize_fund_code

    fund_code = _normalize_fund_code(fund_code)
    record = db.query(FundPortfolio).filter(FundPortfolio.fund_code == fund_code).first()
    if not record:
        record = FundPortfolio(fund_code=fund_code)
        db.add(record)

    record.stock_codes_json = _json_dumps(stock_items)
    record.stock_codes_new_json = _json_dumps(stock_items)
    record.bond_codes_json = _json_dumps(data.get("bondCodes", []) if isinstance(data, dict) else [])
    record.bond_codes_new_json = _json_dumps(data.get("bondCodesNew", []) if isinstance(data, dict) else [])
    record.updated_time = datetime.now()
    return record
