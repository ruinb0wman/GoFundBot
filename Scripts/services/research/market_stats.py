from services.helpers import _avg, _median, _positive_rate

from . import _fund_group_key, _research_base_rows, _research_fund_row
from .constants import RESEARCH_FUND_GROUPS


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
