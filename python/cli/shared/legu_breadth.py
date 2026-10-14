"""涨跌家数回退源：乐咕乐股（`ak.stock_market_activity_legu`）。

为什么需要它：`breadth` 的唯一来源是东财 push2 `ulist.np/get`，而它是**路径级限流**的
（密集请求后该路径整段拒绝几分钟到几小时，IPv4/IPv6 一起挂，见 2026-10-14 实测
`.pi/plans/push2-resilience.md` §5），期间涨跌家数只能报 unavailable。

**口径差异**（不要拿去和东财的数值逐位对齐）：东财用的是「上证指数 / 深证成指成分的
f104/f105/f106 相加」，这里是乐咕自己统计的全市场家数（还单列「停牌」），两者会差几十只；
`limit_up` / `limit_down` 取它的「涨停 / 跌停」列（含 ST），东财那份取的是 push2ex 涨跌停池。

失败时抛异常（不返回空表），保持「失败不落缓存」的纪律。
"""


def _to_number(value: object) -> float | None:
    try:
        return float(str(value))
    except (ValueError, TypeError):
        return None


def fetch_market_breadth() -> dict:
    """返回 `{date, up_count, down_count, flat_count, limit_up, limit_down, total, scope}`。"""
    import akshare as ak

    try:
        df = ak.stock_market_activity_legu()
    except Exception as e:
        raise RuntimeError(f"akshare market activity failed: {e}") from e
    if df is None or df.empty:
        raise RuntimeError("akshare market activity returned no rows")

    stats: dict[str, float | None] = {}
    for _, row in df.iterrows():
        item = str(row.get("item", "") or "").strip()
        if item:
            stats[item] = _to_number(row.get("value"))

    def count(label: str) -> float:
        value = stats.get(label)
        if value is None:
            raise RuntimeError(f"market activity 缺少「{label}」字段（上游改版？）")
        return value

    up, down, flat = count("上涨"), count("下跌"), count("平盘")
    stamp_rows = df.loc[df["item"].astype(str).str.strip() == "统计日期", "value"]
    if stamp_rows.empty:
        raise RuntimeError("market activity 缺少「统计日期」字段（上游改版？）")
    stamp = str(stamp_rows.iloc[0])  # 形如 `2026-10-14 15:00:00`

    return {
        "date": stamp[:10],
        "up_count": up,
        "down_count": down,
        "flat_count": flat,
        "limit_up": stats.get("涨停"),
        "limit_down": stats.get("跌停"),
        "total": up + down + flat,
        "scope": "沪深两市",
    }


if __name__ == "__main__":  # pragma: no cover - 手工排查用
    import json

    print(json.dumps(fetch_market_breadth(), ensure_ascii=False))
