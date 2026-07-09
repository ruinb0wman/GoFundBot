from datetime import datetime

from models import FundBasicInfo, FundIndustryTag, FundPortfolio, StockIndustry
from services.helpers import _json_loads, _normalize_fund_code
from services.industry_classification import _build_portfolio_industry_tag
from services.stock_industry import _resolve_stock_industries
from services.stock_utils import _portfolio_holding_items, _safe_ratio


def _enhance_portfolio_industries(db, portfolio, force_refresh=False):
    if not isinstance(portfolio, dict):
        return portfolio

    target_keys = ["stock_codes_new", "stock_codes"]
    all_holdings = []
    for key in target_keys:
        all_holdings.extend(_portfolio_holding_items(portfolio.get(key)))

    industry_map, unresolved = _resolve_stock_industries(
        db,
        all_holdings,
        force_refresh=force_refresh,
        allow_network=force_refresh,
    )

    for key in target_keys:
        items = _portfolio_holding_items(portfolio.get(key))
        if not items:
            continue
        enhanced = []
        for item in items:
            info = industry_map.get(item.get("code"), {})
            enhanced.append(
                {
                    **item,
                    "industry": info.get("industry"),
                    "region": info.get("region"),
                    "concepts": info.get("concepts") or [],
                }
            )
        portfolio[key] = enhanced

    portfolio["industry_unresolved_codes"] = unresolved
    portfolio["industry_tag"] = _build_portfolio_industry_tag(portfolio)
    return portfolio


def _build_fund_industry_exposure(db, fund_code, force_refresh=False):
    from services.fund_industry.tagging import _upsert_fund_industry_tag

    fund_code = _normalize_fund_code(fund_code)
    portfolio = db.query(FundPortfolio).filter(FundPortfolio.fund_code == fund_code).first()
    if not portfolio:
        return None

    holdings = _json_loads(portfolio.stock_codes_new_json, []) or _json_loads(portfolio.stock_codes_json, [])
    holding_items = _portfolio_holding_items(holdings)
    industry_map, unresolved = _resolve_stock_industries(
        db, holding_items, force_refresh=force_refresh, allow_network=force_refresh
    )

    exposure = {}
    enriched_holdings = []
    for item in holding_items:
        code = item.get("code")
        info = industry_map.get(code, {})
        industry = info.get("industry") or "\u672a\u8bc6\u522b"
        ratio = _safe_ratio(item.get("ratio"))
        enriched_item = {
            **item,
            "industry": info.get("industry"),
            "region": info.get("region"),
            "concepts": info.get("concepts") or [],
        }
        enriched_holdings.append(enriched_item)
        bucket = exposure.setdefault(industry, {"industry": industry, "ratio": 0.0, "count": 0, "stocks": []})
        bucket["ratio"] += ratio
        bucket["count"] += 1
        bucket["stocks"].append({"code": code, "name": item.get("name"), "ratio": ratio})

    exposure_items = sorted(exposure.values(), key=lambda x: (x["ratio"], x["count"]), reverse=True)
    for item in exposure_items:
        item["ratio"] = round(item["ratio"], 2)

    basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
    result = {
        "fund_code": fund_code,
        "holdings": enriched_holdings,
        "industries": exposure_items,
        "industry_tag": _build_portfolio_industry_tag(
            {
                "stock_codes_new": enriched_holdings,
                "fund_name": basic.fund_name if basic else fund_code,
                "fund_type": basic.fund_type if basic else None,
            }
        ),
        "unresolved_codes": unresolved,
        "updated_time": datetime.now().isoformat(),
    }
    _upsert_fund_industry_tag(
        db, fund_code, result["industry_tag"], detail={"industries": exposure_items}, unresolved_count=len(unresolved)
    )
    return result


def _screening_industry_context(db, fund_codes):
    codes = [str(code) for code in fund_codes if code]
    if not codes:
        return {}

    from services.fund_industry.tagging import _upsert_fund_industry_tag

    persisted = db.query(FundIndustryTag).filter(FundIndustryTag.fund_code.in_(codes)).all()
    tag_map = {
        item.fund_code: {
            "name": item.industry_tag,
            "ratio": item.industry_ratio,
            "count": item.industry_count,
            "basis": item.basis,
            "source": item.source,
        }
        for item in persisted
    }
    missing_codes = [code for code in codes if code not in tag_map]
    if not missing_codes:
        return tag_map

    portfolios = db.query(FundPortfolio).filter(FundPortfolio.fund_code.in_(missing_codes)).all()
    portfolio_map = {item.fund_code: item for item in portfolios}

    stock_codes = set()
    for portfolio in portfolios:
        raw_holdings = _json_loads(portfolio.stock_codes_new_json, []) or _json_loads(portfolio.stock_codes_json, [])
        for item in _portfolio_holding_items(raw_holdings):
            if item.get("code"):
                stock_codes.add(item.get("code"))

    if stock_codes:
        records = db.query(StockIndustry).filter(StockIndustry.stock_code.in_(stock_codes)).all()
        {record.stock_code: {"industry": record.industry, "stock_name": record.stock_name} for record in records}

    for fund_code, portfolio in portfolio_map.items():
        raw_holdings = _json_loads(portfolio.stock_codes_new_json, []) or _json_loads(portfolio.stock_codes_json, [])
        basic = db.query(FundBasicInfo).filter(FundBasicInfo.fund_code == fund_code).first()
        tag = _build_portfolio_industry_tag(
            {
                "stock_codes_new": _portfolio_holding_items(raw_holdings),
                "fund_name": basic.fund_name if basic else None,
                "fund_type": basic.fund_type if basic else None,
            }
        )
        tag_map[fund_code] = tag
        _upsert_fund_industry_tag(db, fund_code, tag, detail={"source": "screening_cache_backfill"})
    return tag_map
