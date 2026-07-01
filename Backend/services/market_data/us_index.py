"""
美股指数历史 K 线数据（akshare 双源回退）
"""

import logging
from datetime import date
from typing import Any

logger = logging.getLogger(__name__)

US_INDEX_SINA_SYMBOLS = {
    "gb_ixic": ".IXIC",
    "gb_dji": ".DJI",
    "gb_inx": ".INX",
}

US_INDEX_EM_SYMBOLS = {
    "gb_ixic": "纳斯达克",
    "gb_dji": "道琼斯",
    "gb_inx": "标普500",
}


def _ensure_akshare() -> bool:
    import os

    if os.environ.get("DISABLE_AKSHARE_FALLBACK") == "1":
        return False
    try:
        import akshare  # noqa: F401

        return True
    except ImportError:
        logger.warning("akshare 未安装，美股指数 K 线不可用")
        return False


def _safe_float_str(val: Any) -> str:
    try:
        return f"{float(val):.2f}"
    except (ValueError, TypeError):
        return "0.00"


def _get_klines_sina(symbol: str) -> list[dict[str, Any]]:
    import akshare as ak

    sina_symbol = US_INDEX_SINA_SYMBOLS.get(symbol)
    if not sina_symbol:
        return []

    df = ak.index_us_stock_sina(symbol=sina_symbol)
    if df is None or df.empty:
        return []

    klines = []
    prev_close = None
    for _, row in df.iterrows():
        d = row["date"]
        if isinstance(d, date):
            date_str = d.strftime("%Y%m%d")
        else:
            date_str = str(d).replace("-", "")[:8]
        o = float(row["open"])
        h = float(row["high"])
        lo = float(row["low"])
        c = float(row["close"])
        v = int(row.get("volume", 0))
        a = int(row.get("amount", 0))

        if prev_close is not None and prev_close > 0:
            change = c - prev_close
            change_pct = (c - prev_close) / prev_close * 100
            amplitude = (h - lo) / prev_close * 100
        else:
            change = 0.0
            change_pct = 0.0
            amplitude = (h - lo) / c * 100 if c > 0 else 0.0

        klines.append(
            {
                "date": date_str,
                "open": _safe_float_str(o),
                "close": _safe_float_str(c),
                "high": _safe_float_str(h),
                "low": _safe_float_str(lo),
                "volume": str(v),
                "amount": str(a),
                "amplitude": _safe_float_str(amplitude),
                "changePercent": _safe_float_str(change_pct),
                "change": _safe_float_str(change),
                "turnoverRate": "0.00",
            }
        )
        prev_close = c

    return klines


def _get_klines_em(symbol: str) -> list[dict[str, Any]]:
    import akshare as ak

    em_name = US_INDEX_EM_SYMBOLS.get(symbol)
    if not em_name:
        return []

    try:
        df = ak.index_global_hist_em(symbol=em_name)
    except Exception:
        return []

    if df is None or df.empty:
        return []

    klines = []
    prev_close = None
    for _, row in df.iterrows():
        date_str = str(row.get("日期", ""))[:10].replace("-", "")
        if not date_str:
            continue
        o = float(row.get("今开", 0))
        c = float(row.get("最新价", 0))
        h = float(row.get("最高", 0))
        lo_val = float(row.get("最低", 0))

        if prev_close is not None and prev_close > 0:
            change = c - prev_close
            change_pct = (c - prev_close) / prev_close * 100
        else:
            change = 0.0
            change_pct = 0.0

        amplitude_val = float(row.get("振幅", 0))

        klines.append(
            {
                "date": date_str,
                "open": _safe_float_str(o),
                "close": _safe_float_str(c),
                "high": _safe_float_str(h),
                "low": _safe_float_str(lo_val),
                "volume": "0",
                "amount": "0",
                "amplitude": _safe_float_str(amplitude_val),
                "changePercent": _safe_float_str(change_pct),
                "change": _safe_float_str(change),
                "turnoverRate": "0.00",
            }
        )
        prev_close = c

    return klines


def get_us_index_kline(
    symbol: str,
    start_date: str = "",
    end_date: str = "",
) -> dict[str, Any]:
    if not _ensure_akshare():
        return {"success": False, "data": [], "error": "akshare 不可用"}

    klines = []
    source = ""

    try:
        klines = _get_klines_sina(symbol)
        if klines:
            source = "akshare/sina"
            logger.info(f"美股指数 K 线 ({symbol}): 新浪返回 {len(klines)} 条")
    except Exception as exc:
        logger.warning(f"美股指数 K 线 ({symbol}) 新浪失败: {exc}")

    if not klines:
        try:
            klines = _get_klines_em(symbol)
            if klines:
                source = "akshare/eastmoney"
                logger.info(f"美股指数 K 线 ({symbol}): 东方财富返回 {len(klines)} 条")
        except Exception as exc:
            logger.warning(f"美股指数 K 线 ({symbol}) 东方财富失败: {exc}")

    if not klines:
        return {"success": False, "data": [], "error": "所有美股数据源均不可用"}

    if start_date:
        klines = [k for k in klines if k["date"] >= start_date]
    if end_date:
        klines = [k for k in klines if k["date"] <= end_date]

    from datetime import datetime

    return {
        "success": True,
        "data": klines,
        "total_count": len(klines),
        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": source,
    }
