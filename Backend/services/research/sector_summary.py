from core.logging import get_logger
from services.data_service_client import DataServiceError, get_data_service_client
from services.helpers import _to_float

logger = get_logger(__name__)


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
