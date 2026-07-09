import re

_EXCHANGE_SUFFIX_MAP = {
    ".NS": ("印度", "IN"),
    ".BO": ("印度", "IN"),
    ".T": ("日本", "JP"),
    ".DE": ("德国", "DE"),
    ".PA": ("法国", "FR"),
    ".L": ("英国", "GB"),
    ".HK": ("香港", "HK"),
    ".MC": ("西班牙", "ES"),
    ".MI": ("意大利", "IT"),
    ".SW": ("瑞士", "CH"),
    ".AS": ("荷兰", "NL"),
    ".BR": ("巴西", "BR"),
    ".TO": ("加拿大", "CA"),
    ".V": ("加拿大", "CA"),
    ".AX": ("澳大利亚", "AU"),
    ".KS": ("韩国", "KR"),
    ".TW": ("台湾", "TW"),
    ".SS": ("中国", "CN"),
    ".SZ": ("中国", "CN"),
}


def _normalize_stock_code(code):
    text = str(code or "").strip()
    text = re.sub(r"^(sh|sz|hk)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\.(SH|SZ|HK)$", "", text, flags=re.IGNORECASE)
    if re.match(r"^[A-Za-z]{1,6}([.-][A-Za-z]{1,3})?$", text):
        return text.upper()
    return text if re.match(r"^\d{5,6}$", text) else text


def _is_us_stock_code(code):
    text = str(code or "").strip().upper()
    if not text or re.match(r"^\d{5,6}$", text):
        return False
    return bool(re.match(r"^[A-Z]{1,6}([.-][A-Za-z]{1,3})?$", text))


def _detect_market_from_code(code):
    text = str(code or "").strip().upper()
    for suffix, (name, region) in _EXCHANGE_SUFFIX_MAP.items():
        if text.endswith(suffix):
            return (name, region)
    return None


def _market_hint_from_holdings(holdings, code):
    items = _portfolio_holding_items(holdings)
    for item in items:
        item_code = _normalize_stock_code(item.get("code", ""))
        if item_code != code:
            continue
        market = str(item.get("market") or item.get("region") or "").strip()
        name = str(item.get("name") or "").strip()
        MARKET_NAME_MAP = {
            "印度": ("印度", "IN"),
            "日本": ("日本", "JP"),
            "德国": ("德国", "DE"),
            "法国": ("法国", "FR"),
            "英国": ("英国", "GB"),
            "美国": ("美股", "US"),
            "美股": ("美股", "US"),
            "港股": ("港股", "HK"),
            "香港": ("香港", "HK"),
            "韩国": ("韩国", "KR"),
            "台湾": ("台湾", "TW"),
            "越南": ("越南", "VN"),
            "新加坡": ("新加坡", "SG"),
            "澳大利亚": ("澳洲", "AU"),
        }
        for key, (industry, region) in MARKET_NAME_MAP.items():
            if key in market or key in name:
                return {"industry": industry, "region": region, "name": name or code, "source": "holding_market_field"}
        suffix_hint = _detect_market_from_code(name or item.get("original_code", code))
        if suffix_hint:
            return {
                "industry": suffix_hint[0],
                "region": suffix_hint[1],
                "name": name or code,
                "source": "holding_name_suffix",
            }
    hint = _detect_market_from_code(code)
    if hint:
        return {"industry": hint[0], "region": hint[1], "name": code, "source": "code_suffix_detect"}
    return {"industry": "海外", "region": "WW", "name": code, "source": "unknown_ticker"}


def _is_a_share_stock_code(code):
    return bool(re.match(r"^\d{6}$", str(code or "").strip()))


def _is_hk_holding_item(item):
    if not isinstance(item, dict):
        return False
    market = str(item.get("market") or item.get("region") or "").upper()
    code = str(item.get("code") or item.get("stock_code") or item.get("original_code") or "").strip()
    return market in ("HK", "HKG", "香港", "港股") or bool(re.match(r"^\d{5}$", code))


def _safe_ratio(value):
    if value is None:
        return 0.0
    text = str(value).strip().replace("%", "")
    try:
        return float(text)
    except Exception:
        return 0.0


def _portfolio_holding_items(raw_holdings):
    if not isinstance(raw_holdings, list):
        return []

    if raw_holdings and isinstance(raw_holdings[0], dict):
        items = []
        for item in raw_holdings:
            code = _normalize_stock_code(item.get("code") or item.get("stock_code") or item.get("gpdm"))
            if not code:
                continue
            ratio_value = item.get("ratio") or item.get("position") or item.get("hold_ratio")
            items.append(
                {
                    **item,
                    "code": code,
                    "name": item.get("name") or item.get("stock_name") or item.get("gpmc") or "",
                    "ratio": _safe_ratio(ratio_value),
                    "ratio_available": ratio_value not in (None, "", "-", "--"),
                }
            )
        return items

    items = []
    for index in range(0, len(raw_holdings), 3):
        if index + 2 >= len(raw_holdings):
            break
        code = _normalize_stock_code(raw_holdings[index])
        if not code:
            continue
        ratio_value = raw_holdings[index + 2]
        items.append(
            {
                "code": code,
                "name": raw_holdings[index + 1],
                "ratio": _safe_ratio(ratio_value),
                "ratio_available": ratio_value not in (None, "", "-", "--"),
            }
        )
    return items


def _fund_name_or_type_text(portfolio: dict):
    if not isinstance(portfolio, dict):
        return ""
    parts = [
        portfolio.get("fund_name"),
        portfolio.get("name"),
        portfolio.get("fund_type"),
        portfolio.get("type"),
        portfolio.get("index_name"),
        portfolio.get("tracking_index"),
    ]
    return " ".join(str(part) for part in parts if part)
