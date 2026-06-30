import json
import logging
import os
import threading
import time
from datetime import datetime
from typing import Any, Optional

from core.errors import MarketDataError
from providers import eastmoney as em
from providers import tencent as tx
from services.market_data.formatters import (
    _board_to_legacy,
    _format_kline_date,
    _safe_float,
    _safe_float_str,
    _to_date_dash,
)

logger = logging.getLogger(__name__)


def _akshare_disabled() -> bool:
    return os.environ.get("DISABLE_AKSHARE_FALLBACK") == "1"


class MarketDataService:
    _instance: Optional["MarketDataService"] = None

    CACHE_TTL: dict[str, int] = {
        "industry_boards": 300,
        "industry_spot": 60,
        "industry_constituents": 300,
        "a_stock_kline": 60,
        "realtime_quotes": 60,
    }

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._cache: dict[str, Any] = {}
        self._cache_time: dict[str, float] = {}
        self._lock = threading.Lock()
        self._initialized = True

    # -- Cache --

    def _cache_get(self, key: str) -> Any | None:
        with self._lock:
            if key in self._cache:
                data, expire = self._cache[key]
                if time.time() < expire:
                    return data
        return None

    def _cache_get_stale(self, key: str) -> Any | None:
        with self._lock:
            entry = self._cache.get(key)
            return entry[0] if entry else None

    def _cache_set(self, key: str, data: Any, ttl_key: str):
        with self._lock:
            ttl = self.CACHE_TTL.get(ttl_key, 60)
            self._cache[key] = (data, time.time() + ttl)

    # -- Industry boards --

    def get_industry_boards(
        self,
        *,
        page: int = 1,
        page_size: int = 500,
        use_cache: bool = True,
    ) -> dict[str, Any]:
        cache_key = f"boards_{page}_{page_size}"
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached:
                return cached

        data_date = self._last_trading_date()
        boards: list[dict] = []
        source = ""

        try:
            boards = self._get_boards_akshare(page_size)
            if boards:
                source = "akshare"
                logger.info(
                    f"[MarketData] \u540c\u82b1\u987a\u677f\u5757\u6570\u636e\u83b7\u53d6\u6210\u529f\uff0c\u5171 {len(boards)} \u6761"
                )
        except Exception as exc:
            logger.warning(f"[MarketData] akshare \u677f\u5757\u5217\u8868\u5931\u8d25: {exc}")

        if not boards:
            stale = self._cache_get_stale(cache_key)
            if stale and stale.get("data"):
                stale["source"] = "stale_cache"
                stale["is_stale"] = True
                return stale
            file_cached = self._load_file_cache("sector_rank", page_size)
            if file_cached:
                file_cached["source"] = "file_cache"
                file_cached["is_stale"] = True
                self._cache_set(cache_key, file_cached, "industry_boards")
                return file_cached
            return {
                "success": False,
                "data": [],
                "error": "\u83b7\u53d6\u677f\u5757\u5217\u8868\u5931\u8d25",
            }

        result = {
            "success": True,
            "data": [_board_to_legacy(b) for b in boards],
            "total_count": len(boards),
            "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "data_date": data_date,
            "source": source,
        }
        self._cache_set(cache_key, result, "industry_boards")
        self._save_file_cache("sector_rank", result)
        return result

    # -- Industry spot --

    def get_industry_spot(self, board_code: str, use_cache: bool = True) -> dict[str, Any]:
        cache_key = f"spot_{board_code}"
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached:
                return cached

        try:
            spot = em.get_industry_spot(board_code)
            spot["update_time"] = datetime.now().strftime("%H:%M:%S")
            self._cache_set(cache_key, spot, "industry_spot")
            return spot
        except MarketDataError as exc:
            logger.warning(f"[MarketData] \u677f\u5757 {board_code} \u5b9e\u65f6\u884c\u60c5\u5931\u8d25: {exc}")
            stale = self._cache_get_stale(cache_key)
            if stale:
                stale["is_stale"] = True
                return stale
            return {"code": board_code, "error": str(exc)}

    # -- Industry constituents --

    def get_industry_constituents(
        self,
        board_code: str,
        *,
        page: int = 1,
        page_size: int = 500,
        use_cache: bool = True,
    ) -> dict[str, Any]:
        cache_key = f"constituents_{board_code}_{page}_{page_size}"
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached:
                return cached

        stocks: list[dict] = []
        source = ""

        try:
            stocks = em.get_industry_constituents(board_code, page=page, page_size=page_size)
            source = "eastmoney"
        except MarketDataError as exc:
            logger.warning(f"[MarketData] \u677f\u5757 {board_code} \u6210\u4efd\u80a1 East Money \u5931\u8d25: {exc}")

        if not stocks:
            try:
                stocks = self._get_constituents_akshare(board_code, page_size)
                source = "akshare"
            except Exception as exc:
                logger.warning(f"[MarketData] \u677f\u5757 {board_code} \u6210\u4efd\u80a1 akshare \u5931\u8d25: {exc}")

        if not stocks:
            stale = self._cache_get_stale(cache_key)
            if stale and stale.get("data"):
                stale["is_stale"] = True
                return stale
            return {"success": False, "data": [], "error": "\u83b7\u53d6\u6210\u4efd\u80a1\u5931\u8d25"}

        result = {
            "success": True,
            "data": stocks,
            "total_count": len(stocks),
            "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "source": source,
        }
        self._cache_set(cache_key, result, "industry_constituents")
        return result

    # -- A stock K-line --

    def get_a_stock_kline(
        self,
        stock_code: str,
        *,
        klt: str = "daily",
        fqt: str = "qfq",
        start_date: str = "",
        end_date: str = "",
        use_cache: bool = True,
    ) -> dict[str, Any]:
        cache_key = f"kline_{stock_code}_{klt}_{fqt}_{start_date}_{end_date}"
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached:
                return cached

        try:
            klines = tx.get_kline(
                stock_code,
                period=klt,
                adjust=fqt,
                start_date=_to_date_dash(start_date),
                end_date=_to_date_dash(end_date),
            )
            if klines:
                result = {
                    "success": True,
                    "data": klines,
                    "total_count": len(klines),
                    "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "source": "tencent",
                }
                self._cache_set(cache_key, result, "a_stock_kline")
                return result
            logger.warning(
                f"[MarketData] \u817e\u8baf K\u7ebf {stock_code} \u8fd4\u56de\u7a7a\u6570\u636e\uff0c\u5c1d\u8bd5\u4e1c\u65b9\u8d22\u5bcc"
            )
        except Exception as exc:
            logger.warning(
                f"[MarketData] \u817e\u8baf K\u7ebf {stock_code} \u5931\u8d25: {exc}\uff0c\u5c1d\u8bd5\u4e1c\u65b9\u8d22\u5bcc"
            )

        try:
            klines = em.get_a_stock_kline(
                stock_code,
                klt=klt,
                fqt=fqt,
                start_date=start_date,
                end_date=end_date,
            )
            result = {
                "success": True,
                "data": klines,
                "total_count": len(klines),
                "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "source": "eastmoney",
            }
            self._cache_set(cache_key, result, "a_stock_kline")
            return result
        except MarketDataError as exc:
            logger.warning(f"[MarketData] EastMoney K\u7ebf {stock_code} \u5931\u8d25: {exc}")

        if not _akshare_disabled():
            try:
                klines = _get_kline_akshare(stock_code, klt=klt, fqt=fqt, start_date=start_date, end_date=end_date)
                if klines:
                    result = {
                        "success": True,
                        "data": klines,
                        "total_count": len(klines),
                        "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "source": "akshare",
                    }
                    self._cache_set(cache_key, result, "a_stock_kline")
                    return result
                logger.warning(f"[MarketData] akshare K\u7ebf {stock_code} \u8fd4\u56de\u7a7a\u6570\u636e")
            except Exception as exc:
                logger.warning(f"[MarketData] akshare K\u7ebf {stock_code} \u4e5f\u5931\u8d25: {exc}")

        return {
            "success": False,
            "data": [],
            "error": "\u6240\u6709\u6570\u636e\u6e90\uff08\u817e\u8baf/\u4e1c\u65b9\u8d22\u5bcc/akshare\uff09\u5747\u4e0d\u53ef\u7528",
        }

    # -- Realtime quotes --

    def get_realtime_quotes(
        self,
        codes: list[str],
        *,
        use_cache: bool = True,
    ) -> dict[str, Any]:
        cache_key = f"qt_{'_'.join(sorted(codes))}"
        if use_cache:
            cached = self._cache_get(cache_key)
            if cached:
                return cached

        try:
            quotes = tx.get_realtime_quotes(codes)
            result = {
                "success": True,
                "data": quotes,
                "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            self._cache_set(cache_key, result, "realtime_quotes")
            return result
        except MarketDataError as exc:
            logger.warning(f"[MarketData] \u817e\u8baf\u884c\u60c5\u5931\u8d25: {exc}")
            return {"success": False, "data": [], "error": str(exc)}

    def get_realtime_quote(self, code: str, *, use_cache: bool = True) -> dict[str, Any]:
        result = self.get_realtime_quotes([code], use_cache=use_cache)
        if result["success"] and result["data"]:
            return result["data"][0]
        return {}

    # -- Market indices --

    def get_market_indices(self, secids: list[str]) -> dict[str, Any]:
        try:
            indices = em.get_market_indices(secids)
            return {
                "success": True,
                "data": indices,
                "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
        except MarketDataError as exc:
            logger.warning(f"[MarketData] \u6307\u6570\u5931\u8d25: {exc}")
            return {"success": False, "data": [], "error": str(exc)}

    # -- Internal: akshare fallback --

    def _get_boards_akshare(self, limit: int) -> list[dict]:
        if _akshare_disabled():
            return []
        try:
            import akshare as ak
        except ImportError:
            return []

        for fn_name in ("stock_board_industry_summary_ths", "stock_board_industry_name_em"):
            try:
                fn = getattr(ak, fn_name, None)
                if not fn:
                    continue
                df = fn()
                if df is None or df.empty:
                    continue
                rows = []
                for _, row in df.head(max(limit, 80)).iterrows():
                    name = row.get("\u677f\u5757") or row.get("\u677f\u5757\u540d\u79f0") or row.get("\u540d\u79f0")
                    if not name:
                        continue
                    change = row.get("\u6da8\u8dcc\u5e45") or row.get("\u6da8\u5e45") or 0
                    net_inflow = row.get("\u51c0\u6d41\u5165") or row.get("\u4e3b\u529b\u51c0\u6d41\u5165") or 0
                    amount_yi = _safe_float(row.get("\u603b\u6210\u4ea4\u989d", 0))
                    inflow_yi = _safe_float(net_inflow)
                    rows.append(
                        {
                            "name": str(name),
                            "code": str(row.get("\u677f\u5757\u4ee3\u7801", row.get("\u4ee3\u7801", ""))),
                            "changePercent": _safe_float(change),
                            "price": _safe_float(row.get("\u5747\u4ef7", 0)),
                            "volume": _safe_float(row.get("\u603b\u6210\u4ea4\u91cf", 0)),
                            "amount": amount_yi * 1e8,
                            "mainNetInflow": inflow_yi * 1e8,
                            "riseCount": int(_safe_float(row.get("\u4e0a\u6da8\u5bb6\u6570", 0))),
                            "fallCount": int(_safe_float(row.get("\u4e0b\u8dcc\u5bb6\u6570", 0))),
                            "leadingStock": str(row.get("\u9886\u6da8\u80a1", "")),
                            "leadingStockPrice": _safe_float(row.get("\u9886\u6da8\u80a1-\u6700\u65b0\u4ef7", 0)),
                            "leadingStockChangePercent": _safe_float(
                                row.get("\u9886\u6da8\u80a1-\u6da8\u8dcc\u5e45", 0)
                            ),
                        }
                    )
                rows.sort(key=lambda x: x["changePercent"], reverse=True)
                if rows:
                    return rows
            except Exception:
                continue
        return []

    def _get_constituents_akshare(self, board_code: str, limit: int) -> list[dict]:
        if _akshare_disabled():
            return []
        try:
            import akshare as ak
        except ImportError:
            return []

        try:
            df = ak.stock_board_cons_ths(board_code)
            if df is None or df.empty:
                return []
            rows = []
            for _, row in df.head(limit).iterrows():
                rows.append(
                    {
                        "code": str(row.get("\u4ee3\u7801", "")),
                        "name": str(row.get("\u540d\u79f0", "")),
                        "price": _safe_float(row.get("\u6700\u65b0\u4ef7", 0)),
                        "changePercent": _safe_float(row.get("\u6da8\u8dcc\u5e45", 0)),
                        "change": _safe_float(row.get("\u6da8\u8dcc\u989d", 0)),
                    }
                )
            return rows
        except Exception:
            return []

    # -- Internal: date tools --

    def _last_trading_date(self) -> str:
        now = datetime.now()
        day = now.date()
        minutes = now.hour * 60 + now.minute
        if day.weekday() >= 5 or minutes < 9 * 60 + 30:
            day -= datetime.timedelta(days=1)
        while day.weekday() >= 5:
            day -= datetime.timedelta(days=1)
        return day.strftime("%Y-%m-%d")

    # -- Internal: file cache --

    def _cache_file_path(self, name: str) -> str:
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return os.path.join(root, "Data", f"{name}_cache.json")

    def _save_file_cache(self, name: str, data: dict):
        try:
            path = self._cache_file_path(name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        except Exception:
            pass

    def _load_file_cache(self, name: str, limit: int) -> dict | None:
        try:
            path = self._cache_file_path(name)
            if not os.path.exists(path):
                return None
            with open(path, encoding="utf-8") as f:
                cached = json.load(f)
            rows = cached.get("data") or []
            if not rows:
                return None
            if any("?" in str(r.get("name") or "") for r in rows):
                return None
            return {**cached, "data": rows[:limit]}
        except Exception:
            return None


def _get_kline_akshare(
    stock_code: str,
    *,
    klt: str = "daily",
    fqt: str = "qfq",
    start_date: str = "",
    end_date: str = "",
) -> list[dict[str, Any]]:
    if _akshare_disabled():
        return []
    import akshare as ak

    if klt not in ("daily", ""):
        logger.warning(
            f"[MarketData] akshare \u4ec5\u652f\u6301\u65e5\u7ebf\uff0c\u6536\u5230 {klt}\uff0c\u964d\u7ea7\u4e3a daily"
        )
        klt = "daily"

    akshare_adjust = ""
    if fqt == "qfq":
        akshare_adjust = "qfq"
    elif fqt == "hfq":
        akshare_adjust = "hfq"

    df = ak.stock_zh_a_hist(
        symbol=stock_code,
        period=klt,
        start_date=start_date,
        end_date=end_date,
        adjust=akshare_adjust,
    )

    if df is None or df.empty:
        return []

    COLUMN_MAP = {
        "\u65e5\u671f": "date",
        "\u5f00\u76d8": "open",
        "\u6536\u76d8": "close",
        "\u6700\u9ad8": "high",
        "\u6700\u4f4e": "low",
        "\u6210\u4ea4\u91cf": "volume",
        "\u6210\u4ea4\u989d": "amount",
        "\u632f\u5e45": "amplitude",
        "\u6da8\u8dcc\u5e45": "changePercent",
        "\u6da8\u8dcc\u989d": "change",
        "\u6362\u624b\u7387": "turnoverRate",
    }

    result: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        item: dict[str, Any] = {}
        for cn_col, en_col in COLUMN_MAP.items():
            if cn_col in df.columns:
                val = row[cn_col]
                if en_col == "date":
                    item[en_col] = _format_kline_date(val)
                elif en_col in ("volume", "amount"):
                    item[en_col] = str(val) if val is not None else "0"
                else:
                    item[en_col] = _safe_float_str(val)
        if item.get("date"):
            result.append(item)

    return result


_service_instance: MarketDataService | None = None


def get_market_data_service() -> MarketDataService:
    global _service_instance
    if _service_instance is None:
        _service_instance = MarketDataService()
    return _service_instance
