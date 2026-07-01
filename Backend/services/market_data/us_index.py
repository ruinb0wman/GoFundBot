"""
美股指数历史 K 线数据（akshare 双源回退）
"""

import logging
import time
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

# 全球指数 (b_ 前缀) EastMoney 历史 K 线名称映射
# 名称与 ak.index_global_spot_em() 中 "名称" 列一致
GLOBAL_EM_SYMBOLS = {
    "b_nky": "日经225",
    "b_ks11": "韩国KOSPI",
    "b_ukx": "英国富时100",
    "b_dax": "德国DAX30",
    "b_cac": "法国CAC40",
    "b_sensex": "印度孟买SENSEX",
}

# Sina 代码 → EastMoney 全球指数代码
GLOBAL_SPOT_CODE_MAP = {
    "gb_ixic": "NDX",
    "gb_dji": "DJIA",
    "gb_inx": "SPX",
    "hkhsi": "HSI",
    "hkhscei": "HSCEI",
    "hkhstech": "HSTECH",
    "b_nky": "N225",
    "b_ks11": "KS11",
    "b_ukx": "FTSE",
    "b_dax": "GDAXI",
    "b_cac": "FCHI",
    "b_sensex": "SENSEX",
}

_spot_cache: dict[str, dict[str, dict[str, float]]] = {}
_spot_cache_time: float = 0
SPOT_CACHE_TTL = 60


def get_global_index_spot_ohlc() -> dict[str, dict[str, float]]:
    global _spot_cache, _spot_cache_time
    now = time.time()
    if _spot_cache and (now - _spot_cache_time) < SPOT_CACHE_TTL:
        return _spot_cache

    import os

    if os.environ.get("DISABLE_AKSHARE_FALLBACK") == "1":
        return {}

    import akshare as ak

    try:
        df = ak.index_global_spot_em()
    except Exception:
        return {}

    if df is None or df.empty:
        return {}

    reverse_map: dict[str, str] = {v: k for k, v in GLOBAL_SPOT_CODE_MAP.items()}
    result: dict[str, dict[str, float]] = {}
    for _, row in df.iterrows():
        em_code = str(row.get("代码", ""))
        sina_code = reverse_map.get(em_code)
        if not sina_code:
            continue
        result[sina_code] = {
            "open": float(row.get("开盘价", 0)),
            "high": float(row.get("最高价", 0)),
            "low": float(row.get("最低价", 0)),
            "prev_close": float(row.get("昨收价", 0)),
        }

    _spot_cache.clear()
    _spot_cache.update(result)
    _spot_cache_time = now
    return result


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


def get_global_index_kline(
    symbol: str,
    start_date: str = "",
    end_date: str = "",
) -> dict[str, Any]:
    """获取全球指数 (b_ 前缀) K 线数据, 数据源: EastMoney (akshare)"""
    if not _ensure_akshare():
        return {"success": False, "data": [], "error": "akshare 不可用"}

    em_name = GLOBAL_EM_SYMBOLS.get(symbol)
    if not em_name:
        return {"success": False, "data": [], "error": f"不支持的全球指数: {symbol}"}

    import akshare as ak

    try:
        df = ak.index_global_hist_em(symbol=em_name)
    except Exception as exc:
        logger.warning(f"全球指数 K 线 ({symbol}) 东方财富失败: {exc}")
        return {"success": False, "data": [], "error": str(exc)}

    if df is None or df.empty:
        return {"success": False, "data": [], "error": "东方财富未返回数据"}

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

    if start_date:
        klines = [k for k in klines if k["date"] >= start_date]
    if end_date:
        klines = [k for k in klines if k["date"] <= end_date]

    from datetime import datetime

    logger.info(f"全球指数 K 线 ({symbol}): 东方财富返回 {len(klines)} 条")
    return {
        "success": True,
        "data": klines,
        "total_count": len(klines),
        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "akshare/eastmoney",
    }
