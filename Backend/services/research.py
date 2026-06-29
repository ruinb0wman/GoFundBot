from datetime import datetime

import requests
from sqlalchemy import desc

from core.logging import get_logger
from database import SessionLocal
from models import (
    DataFetchTask,
    FundBasicInfo,
    FundEstimate,
    FundEtfTracking,
    FundIndustryTag,
    FundRiskMetrics,
    FundScreeningRank,
)
from services.data_service_client import DataServiceError, get_data_service_client
from services.fund_industry import rebuild_industry_performance_stats
from services.helpers import (
    _avg,
    _json_dumps,
    _json_loads,
    _median,
    _normalize_fund_code,
    _positive_rate,
    _round_or_none,
    _to_float,
)

logger = get_logger(__name__)

RESEARCH_FUND_GROUPS = [
    {"key": "equity", "name": "股票型", "keywords": ["股票"]},
    {"key": "hybrid", "name": "混合型", "keywords": ["混合"]},
    {"key": "bond", "name": "债券型", "keywords": ["债券", "债券型"]},
    {"key": "index", "name": "指数型", "keywords": ["指数", "联接"]},
    {"key": "etf", "name": "ETF", "keywords": ["ETF", "交易型开放式指数"]},
    {"key": "qdii", "name": "QDII", "keywords": ["QDII"]},
    {"key": "fof", "name": "FOF", "keywords": ["FOF"]},
    {"key": "money", "name": "货币型", "keywords": ["货币"]},
]


def _fund_type_matches(fund_type, fund_name, keywords):
    text = f"{fund_type or ''} {fund_name or ''}".upper()
    return any(str(keyword).upper() in text for keyword in keywords)


def _fund_group_key(fund_type, fund_name):
    for group in RESEARCH_FUND_GROUPS:
        if _fund_type_matches(fund_type, fund_name, group["keywords"]):
            return group["key"]
    return "other"


def _research_fund_row(basic, risk=None, rank=None, estimate=None):
    perf = _json_loads(basic.performance_json, {}) if basic else {}
    return {
        "fund_code": basic.fund_code if basic else None,
        "fund_name": basic.fund_name if basic else None,
        "fund_type": basic.fund_type if basic else None,
        "return_1m": _round_or_none(perf.get("1_month_return")),
        "return_3m": _round_or_none(perf.get("3_month_return")),
        "return_6m": _round_or_none(perf.get("6_month_return")),
        "return_1y": _round_or_none(perf.get("1_year_return") if perf else basic.return_1y),
        "return_3y": _round_or_none(perf.get("3_year_return")),
        "max_drawdown_1y": _round_or_none(risk.max_drawdown_1y if risk else None),
        "volatility_1y": _round_or_none(risk.volatility_1y if risk else None),
        "sharpe_ratio_1y": _round_or_none(risk.sharpe_ratio_1y if risk else None),
        "calmar_ratio_1y": _round_or_none(risk.calmar_ratio_1y if risk else None),
        "rank_pct_1y": _round_or_none(rank.rank_pct_1y if rank else None),
        "pass_4433": bool(rank and rank.pass_4433 == 1),
        "estimate_change": _round_or_none(estimate.estimate_change if estimate else None),
        "estimate_time": estimate.estimate_time if estimate else None,
        "nav": _round_or_none(estimate.net_worth if estimate else None, 4),
        "nav_date": estimate.net_worth_date if estimate else None,
        "updated_time": basic.updated_time.isoformat() if basic and basic.updated_time else None,
    }


def _research_base_rows(db):
    return (
        db.query(
            FundBasicInfo,
            FundRiskMetrics,
            FundScreeningRank,
            FundEstimate,
        )
        .outerjoin(FundRiskMetrics, FundBasicInfo.fund_code == FundRiskMetrics.fund_code)
        .outerjoin(FundScreeningRank, FundBasicInfo.fund_code == FundScreeningRank.fund_code)
        .outerjoin(FundEstimate, FundBasicInfo.fund_code == FundEstimate.fund_code)
        .all()
    )


def _build_research_market_stats(db):
    rows = _research_base_rows(db)
    items = [_research_fund_row(basic, risk, rank, estimate) for basic, risk, rank, estimate in rows]
    total = len(items)
    risk_ready = sum(1 for _, risk, _, _ in rows if risk and risk.sharpe_ratio_1y is not None)
    rank_ready = sum(1 for _, _, rank, _ in rows if rank)
    pass_4433 = sum(1 for _, _, rank, _ in rows if rank and rank.pass_4433 == 1)

    type_map = {}
    group_map = {}
    for item in items:
        fund_type = item.get("fund_type") or "未分类"
        type_stat = type_map.setdefault(
            fund_type,
            {
                "fund_type": fund_type,
                "count": 0,
                "pass_4433": 0,
                "return_1y_values": [],
                "return_3m_values": [],
            },
        )
        type_stat["count"] += 1
        type_stat["pass_4433"] += 1 if item.get("pass_4433") else 0
        type_stat["return_1y_values"].append(item.get("return_1y"))
        type_stat["return_3m_values"].append(item.get("return_3m"))

        group_key = _fund_group_key(item.get("fund_type"), item.get("fund_name"))
        group_stat = group_map.setdefault(
            group_key,
            {
                "key": group_key,
                "name": next((g["name"] for g in RESEARCH_FUND_GROUPS if g["key"] == group_key), "其他"),
                "count": 0,
                "return_1y_values": [],
            },
        )
        group_stat["count"] += 1
        group_stat["return_1y_values"].append(item.get("return_1y"))

    type_stats = []
    for stat in type_map.values():
        type_stats.append(
            {
                "fund_type": stat["fund_type"],
                "count": stat["count"],
                "ratio": round(stat["count"] / total * 100, 2) if total else 0,
                "pass_4433": stat["pass_4433"],
                "pass_rate": round(stat["pass_4433"] / stat["count"] * 100, 2) if stat["count"] else 0,
                "return_1y_median": _median(stat["return_1y_values"]),
                "return_3m_median": _median(stat["return_3m_values"]),
            }
        )
    type_stats.sort(key=lambda x: x["count"], reverse=True)

    group_stats = []
    for stat in group_map.values():
        group_stats.append(
            {
                "key": stat["key"],
                "name": stat["name"],
                "count": stat["count"],
                "ratio": round(stat["count"] / total * 100, 2) if total else 0,
                "return_1y_median": _median(stat["return_1y_values"]),
            }
        )
    group_stats.sort(key=lambda x: x["count"], reverse=True)

    latest_update = max(
        (basic.updated_time for basic, _, _, _ in rows if basic and basic.updated_time),
        default=None,
    )

    return {
        "summary": {
            "total_funds": total,
            "risk_ready": risk_ready,
            "risk_ready_rate": round(risk_ready / total * 100, 2) if total else 0,
            "rank_ready": rank_ready,
            "rank_ready_rate": round(rank_ready / total * 100, 2) if total else 0,
            "pass_4433": pass_4433,
            "pass_4433_rate": round(pass_4433 / total * 100, 2) if total else 0,
            "return_1y_median": _median(item.get("return_1y") for item in items),
            "return_3m_median": _median(item.get("return_3m") for item in items),
            "positive_1y_rate": _positive_rate(item.get("return_1y") for item in items),
            "latest_update": latest_update.isoformat() if latest_update else None,
        },
        "type_stats": type_stats[:30],
        "group_stats": group_stats,
    }


def _build_research_fund_dashboard(db, limit=5):
    rows = _research_base_rows(db)
    grouped = {
        group["key"]: {"key": group["key"], "name": group["name"], "items": [], "summary": {}}
        for group in RESEARCH_FUND_GROUPS
    }
    grouped["other"] = {"key": "other", "name": "其他", "items": [], "summary": {}}

    for basic, risk, rank, estimate in rows:
        item = _research_fund_row(basic, risk, rank, estimate)
        group_key = _fund_group_key(item.get("fund_type"), item.get("fund_name"))
        grouped.setdefault(group_key, {"key": group_key, "name": "其他", "items": [], "summary": {}})
        grouped[group_key]["items"].append(item)

    cards = []
    for group in grouped.values():
        items = group["items"]
        if not items:
            continue
        sorted_items = sorted(
            items,
            key=lambda x: (
                x.get("pass_4433") is True,
                x.get("sharpe_ratio_1y") if x.get("sharpe_ratio_1y") is not None else -999,
                x.get("return_1y") if x.get("return_1y") is not None else -999,
            ),
            reverse=True,
        )
        cards.append(
            {
                "key": group["key"],
                "name": group["name"],
                "summary": {
                    "total": len(items),
                    "pass_4433": sum(1 for item in items if item.get("pass_4433")),
                    "return_1y_avg": _avg(item.get("return_1y") for item in items),
                    "sharpe_1y_avg": _avg(item.get("sharpe_ratio_1y") for item in items),
                },
                "items": sorted_items[:limit],
            }
        )

    cards.sort(key=lambda card: card["summary"]["total"], reverse=True)
    return {"cards": cards, "limit": limit}


def _row_value(row, index, *names):
    for name in names:
        try:
            value = row.get(name)
            if value is not None:
                return value
        except Exception:
            pass
    try:
        return row.iloc[index]
    except Exception:
        return None


def _parse_etf_trade_time(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    try:
        num = int(float(value))
        if num > 1000000000:
            return datetime.fromtimestamp(num)
    except Exception:
        pass
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def _refresh_etf_tracking_from_akshare(db, limit=500):
    field_names = "f12,f14,f2,f441,f402,f4,f3,f5,f6,f17,f15,f16,f18,f7,f8,f10,f30,f31,f32,f38,f21,f20,f297,f124"
    params = {
        "pn": "1",
        "pz": str(max(limit, 100)),
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f12",
        "fs": "b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827",
        "fields": field_names,
    }
    rows = []
    source = "eastmoney.push2"
    try:
        response = requests.get(
            "https://88.push2.eastmoney.com/api/qt/clist/get",
            params=params,
            timeout=8,
        )
        response.raise_for_status()
        payload = response.json()
        rows = (payload.get("data") or {}).get("diff") or []
    except Exception as direct_exc:
        logger.error(f"ETF tracking: eastmoney direct unavailable: {direct_exc}")
        try:
            import akshare as ak

            df = ak.fund_etf_spot_em()
            if df is None or getattr(df, "empty", True):
                rows = []
            else:
                rows = [
                    {
                        "f12": _row_value(row, 0, "代码"),
                        "f14": _row_value(row, 1, "名称"),
                        "f2": _row_value(row, 2, "最新价"),
                        "f441": _row_value(row, 3, "IOPV实时估值"),
                        "f402": _row_value(row, 4, "折价率"),
                        "f4": _row_value(row, 5, "涨跌额"),
                        "f3": _row_value(row, 6, "涨跌幅"),
                        "f5": _row_value(row, 7, "成交量"),
                        "f6": _row_value(row, 8, "成交额"),
                        "f8": _row_value(row, 14, "换手率"),
                        "f38": _row_value(row, 32, "最新份额"),
                        "f20": _row_value(row, 34, "总市值"),
                        "f124": _row_value(row, 36, "更新时间"),
                    }
                    for _, row in df.head(limit).iterrows()
                ]
                source = "akshare.eastmoney"
        except Exception as ak_exc:
            raise RuntimeError(f"eastmoney and akshare unavailable: {direct_exc}; {ak_exc}")

    if not rows:
        return 0

    saved = 0
    now = datetime.now()
    for row in rows[:limit]:
        code = _normalize_fund_code(row.get("f12") if isinstance(row, dict) else _row_value(row, 0, "代码"))
        if not code:
            continue

        record = db.query(FundEtfTracking).filter(FundEtfTracking.fund_code == code).first()
        if not record:
            record = FundEtfTracking(fund_code=code)
            db.add(record)

        record.fund_name = str(row.get("f14") or record.fund_name or "")
        record.latest_price = _to_float(row.get("f2"))
        record.iopv = _to_float(row.get("f441"))
        record.discount_rate = _to_float(row.get("f402"))
        record.change_amount = _to_float(row.get("f4"))
        record.change_percent = _to_float(row.get("f3"))
        record.volume = _to_float(row.get("f5"))
        record.amount = _to_float(row.get("f6"))
        record.turnover_rate = _to_float(row.get("f8"))
        record.fund_share = _to_float(row.get("f38"))
        record.market_value = _to_float(row.get("f20"))
        record.trade_time = _parse_etf_trade_time(row.get("f124")) or now
        record.source = source
        record.detail_json = _json_dumps({"fields": field_names.split(",")})
        record.updated_time = now
        saved += 1

    return saved


def _build_etf_tracking_from_cache(limit=80):
    from fund_list_cache import get_fund_list_cache

    cache = get_fund_list_cache()
    funds = []
    for fund in getattr(cache, "fund_list", []) or []:
        name = fund.get("NAME") or fund.get("name") or ""
        code = _normalize_fund_code(fund.get("CODE") or fund.get("code"))
        if code and "ETF" in name.upper():
            funds.append(
                {
                    "fund_code": code,
                    "fund_name": name,
                    "fund_type": "ETF",
                    "estimate_change": None,
                    "return_1y": None,
                    "nav_date": None,
                    "source": "fund_list_cache",
                }
            )

    return {
        "items": funds[:limit],
        "categories": [],
        "summary": {
            "total": len(funds),
            "with_estimate": 0,
            "avg_estimate_change": None,
            "positive_estimate_rate": None,
            "net_flow_available": False,
            "source": "fund_list_cache",
            "stale": True,
            "net_flow_note": "已从本地基金列表识别 ETF 池；实时行情需要刷新 AkShare/东方财富快照后显示。",
        },
    }


def _build_etf_tracking_snapshot(db, limit=80, refresh=False):
    source_error = None
    if refresh or db.query(FundEtfTracking).count() == 0:
        try:
            _refresh_etf_tracking_from_akshare(db, limit=max(limit, 300))
            db.commit()
        except Exception as exc:
            db.rollback()
            source_error = str(exc)
            logger.error(f"ETF tracking: akshare unavailable: {exc}")

    rows = db.query(FundEtfTracking).order_by(desc(FundEtfTracking.change_percent)).limit(limit).all()
    if not rows:
        payload = _build_etf_tracking_from_cache(limit=limit)
        payload["summary"]["source_error"] = source_error
        return payload

    items = []
    for row in rows:
        items.append(
            {
                "fund_code": row.fund_code,
                "fund_name": row.fund_name,
                "fund_type": "ETF",
                "latest_price": row.latest_price,
                "iopv": row.iopv,
                "discount_rate": row.discount_rate,
                "estimate_change": row.change_percent,
                "change_percent": row.change_percent,
                "change_amount": row.change_amount,
                "volume": row.volume,
                "amount": row.amount,
                "turnover_rate": row.turnover_rate,
                "fund_share": row.fund_share,
                "market_value": row.market_value,
                "return_1y": None,
                "nav_date": row.trade_time.date().isoformat() if row.trade_time else None,
                "updated_time": row.updated_time.isoformat() if row.updated_time else None,
                "source": row.source,
            }
        )

    categories = {}
    for item in items:
        name = item.get("fund_name") or ""
        if any(word in name for word in ["债", "货币"]):
            category = "债券/货币 ETF"
        elif any(word in name for word in ["港", "纳斯达克", "标普", "日经", "德国", "QDII"]):
            category = "跨境 ETF"
        elif any(word in name for word in ["黄金", "商品", "能源", "豆粕"]):
            category = "商品 ETF"
        elif any(word in name for word in ["医药", "消费", "芯片", "半导体", "证券", "银行", "军工", "AI", "机器人"]):
            category = "行业主题 ETF"
        else:
            category = "宽基/普通指数 ETF"
        stat = categories.setdefault(category, {"category": category, "count": 0, "estimate_values": []})
        stat["count"] += 1
        stat["estimate_values"].append(item.get("estimate_change"))

    category_items = [
        {
            "category": stat["category"],
            "count": stat["count"],
            "estimate_change_avg": _avg(stat["estimate_values"]),
            "return_1y_median": None,
            "net_flow": None,
        }
        for stat in categories.values()
    ]
    category_items.sort(key=lambda x: x["count"], reverse=True)

    latest_update = max((item.get("updated_time") for item in items if item.get("updated_time")), default=None)
    return {
        "items": items,
        "categories": category_items,
        "summary": {
            "total": db.query(FundEtfTracking).count(),
            "with_estimate": sum(1 for item in items if item.get("estimate_change") is not None),
            "avg_estimate_change": _avg(item.get("estimate_change") for item in items),
            "positive_estimate_rate": _positive_rate(item.get("estimate_change") for item in items),
            "net_flow_available": False,
            "source": "funds.db:fund_etf_tracking",
            "source_error": source_error,
            "latest_update": latest_update,
            "net_flow_note": "ETF 实时行情来自 AkShare/东方财富免费源；资金净流入暂未接入。",
        },
    }


def _build_research_etf_tracking(db, limit=80):
    rows = _research_base_rows(db)
    etf_items = []
    for basic, risk, rank, estimate in rows:
        if _fund_type_matches(basic.fund_type, basic.fund_name, ["ETF", "交易型开放式指数", "指数"]):
            etf_items.append(_research_fund_row(basic, risk, rank, estimate))

    etf_items.sort(
        key=lambda x: (
            x.get("estimate_change") if x.get("estimate_change") is not None else -999,
            x.get("return_1y") if x.get("return_1y") is not None else -999,
        ),
        reverse=True,
    )

    snapshot_count = db.query(FundEtfTracking).count()
    estimate_count = sum(1 for item in etf_items if item.get("estimate_change") is not None)
    if snapshot_count > 0 or not etf_items or estimate_count < max(5, int(len(etf_items) * 0.05)):
        return _build_etf_tracking_snapshot(db, limit=limit)

    category_stats = {}
    for item in etf_items:
        name = item.get("fund_name") or ""
        fund_type = item.get("fund_type") or ""
        if "债" in name or "债" in fund_type:
            category = "债券ETF/指数"
        elif "港" in name or "QDII" in fund_type.upper() or "纳斯达克" in name or "标普" in name:
            category = "跨境ETF/指数"
        elif "黄金" in name or "商品" in name:
            category = "商品ETF/指数"
        elif "行业" in fund_type or any(
            word in name for word in ["医药", "消费", "芯片", "半导体", "证券", "银行", "军工"]
        ):
            category = "行业主题ETF/指数"
        else:
            category = "宽基/普通指数"
        stat = category_stats.setdefault(
            category,
            {
                "category": category,
                "count": 0,
                "estimate_values": [],
                "return_1y_values": [],
            },
        )
        stat["count"] += 1
        stat["estimate_values"].append(item.get("estimate_change"))
        stat["return_1y_values"].append(item.get("return_1y"))

    categories = []
    for stat in category_stats.values():
        categories.append(
            {
                "category": stat["category"],
                "count": stat["count"],
                "estimate_change_avg": _avg(stat["estimate_values"]),
                "return_1y_median": _median(stat["return_1y_values"]),
                "net_flow": None,
            }
        )
    categories.sort(key=lambda x: x["count"], reverse=True)

    return {
        "items": etf_items[:limit],
        "categories": categories,
        "summary": {
            "total": len(etf_items),
            "with_estimate": sum(1 for item in etf_items if item.get("estimate_change") is not None),
            "avg_estimate_change": _avg(item.get("estimate_change") for item in etf_items),
            "positive_estimate_rate": _positive_rate(item.get("estimate_change") for item in etf_items),
            "net_flow_available": False,
            "net_flow_note": "当前数据源尚未接入 ETF 日/周/月资金净流入。",
        },
    }


def _build_research_sector_summary(limit=50):
    try:
        payload = get_data_service_client().get_market_sectors()
        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        rows = data.get("items", []) if isinstance(data, dict) else []
    except DataServiceError as exc:
        logger.error(f"research sector summary: DataService unavailable: {exc}")
        try:
            from fund_master_service import get_fund_master_service

            fallback = get_fund_master_service().get_sector_rank(limit=limit)
            fallback_rows = fallback.get("data", []) if isinstance(fallback, dict) else []
            rows = [
                {
                    "code": item.get("code") or "",
                    "name": item.get("name") or "",
                    "changePercent": item.get("raw_change", item.get("change_pct")),
                    "mainNetInflow": item.get("raw_main_inflow", item.get("main_inflow")),
                }
                for item in fallback_rows
                if isinstance(item, dict)
            ]
        except Exception as fallback_exc:
            logger.error(f"research sector summary: fallback unavailable: {fallback_exc}")
            rows = []
    except Exception as exc:
        logger.error(f"research sector summary: unexpected error: {exc}")
        rows = []

    items = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        change = _to_float(row.get("changePercent"))
        inflow = _to_float(row.get("mainNetInflow"))
        if change is None:
            mood = "unknown"
            summary = "暂无涨跌幅数据"
        elif change >= 2:
            mood = "strong"
            summary = "强势上涨，短线热度较高"
        elif change >= 0:
            mood = "positive"
            summary = "温和上涨，表现好于弱势板块"
        elif change <= -2:
            mood = "weak"
            summary = "明显回调，注意波动风险"
        else:
            mood = "negative"
            summary = "小幅回落，走势偏弱"

        flow_summary = ""
        if inflow is not None:
            if inflow > 0:
                flow_summary = "，主力资金净流入"
            elif inflow < 0:
                flow_summary = "，主力资金净流出"

        items.append(
            {
                "code": row.get("code") or "",
                "name": row.get("name") or "",
                "change_percent": change,
                "main_net_inflow": inflow,
                "mood": mood,
                "summary": f"{summary}{flow_summary}",
            }
        )

    top_gainers = sorted(
        [it for it in items if it.get("change_percent") is not None],
        key=lambda x: x["change_percent"],
        reverse=True,
    )[:8]
    top_losers = sorted(
        [it for it in items if it.get("change_percent") is not None],
        key=lambda x: x["change_percent"],
    )[:8]
    inflow_leaders = sorted(
        [it for it in items if it.get("main_net_inflow") is not None],
        key=lambda x: x["main_net_inflow"],
        reverse=True,
    )[:8]

    return {
        "items": items,
        "top_gainers": top_gainers,
        "top_losers": top_losers,
        "inflow_leaders": inflow_leaders,
        "summary": {
            "total": len(items),
            "strong_count": sum(1 for it in items if it.get("mood") == "strong"),
            "positive_count": sum(
                1 for it in items if it.get("change_percent") is not None and it["change_percent"] >= 0
            ),
            "negative_count": sum(
                1 for it in items if it.get("change_percent") is not None and it["change_percent"] < 0
            ),
        },
    }


def _task_to_research_status(task):
    if not task:
        return {"running": False, "status": "idle", "message": ""}
    return {
        "task_id": task.id,
        "running": task.status == "running",
        "status": task.status,
        "progress": task.current_count or 0,
        "total": task.target_count or 0,
        "success_count": task.success_count or 0,
        "fail_count": task.fail_count or 0,
        "message": task.message or "",
        "started_time": task.started_time.isoformat() if task.started_time else None,
        "finished_time": task.finished_time.isoformat() if task.finished_time else None,
    }


def _latest_research_industry_task(db):
    return (
        db.query(DataFetchTask)
        .filter(DataFetchTask.task_type == "research_industry_performance")
        .order_by(desc(DataFetchTask.started_time), desc(DataFetchTask.id))
        .first()
    )


def _run_research_industry_performance_rebuild(task_id):
    db = SessionLocal()
    try:
        task = db.query(DataFetchTask).filter(DataFetchTask.id == task_id).first()
        if task:
            total = db.query(FundIndustryTag).count()
            task.status = "running"
            task.message = "后台汇总板块行情..."
            task.target_count = total
            task.current_count = 0
            task.updated_time = datetime.now()
            db.commit()

        rebuilt_total = rebuild_industry_performance_stats(db)
        task = db.query(DataFetchTask).filter(DataFetchTask.id == task_id).first()
        if task:
            task.status = "finished"
            task.message = f"板块行情汇总完成，共 {rebuilt_total} 个板块"
            task.current_count = task.target_count or rebuilt_total
            task.success_count = rebuilt_total
            task.fail_count = 0
            task.finished_time = datetime.now()
            task.updated_time = datetime.now()
        db.commit()
    except Exception as exc:
        db.rollback()
        task = db.query(DataFetchTask).filter(DataFetchTask.id == task_id).first()
        if task:
            task.status = "failed"
            task.message = f"板块行情汇总失败: {exc}"
            task.error_message = str(exc)
            task.finished_time = datetime.now()
            task.updated_time = datetime.now()
            db.commit()
    finally:
        db.close()
