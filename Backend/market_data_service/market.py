import logging
from datetime import datetime

from . import base as _base

logger = logging.getLogger(__name__)

try:
    import efinance as ef

    EF_AVAILABLE = True
except Exception:
    EF_AVAILABLE = False


class MarketMixin:
    def get_north_flow(self) -> dict[str, object]:
        cache_key = "north_flow"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        result = {
            "total": 0,
            "sh": 0,
            "sz": 0,
            "update_time": datetime.now().strftime("%H:%M:%S"),
            "status": "unknown",
        }

        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return result

        try:
            logger.info("[市场数据] 获取北向资金数据...")

            try:
                df = self._call_akshare_with_retry(lambda: _base.ak.stock_hsgt_hist_em(symbol="沪股通"), "沪股通历史")
                if df is not None and not df.empty:
                    latest = df.iloc[-1]
                    for col in ["当日资金流入", "资金流入", "当日净流入"]:
                        if col in df.columns:
                            result["sh"] = round(self._safe_float(latest[col]), 2)
                            break
                    logger.info(f"[市场数据] 沪股通: {result['sh']}亿")
            except Exception as e:
                logger.warning(f"[市场数据] 沪股通数据获取失败: {e}")

            try:
                df = self._call_akshare_with_retry(lambda: _base.ak.stock_hsgt_hist_em(symbol="深股通"), "深股通历史")
                if df is not None and not df.empty:
                    latest = df.iloc[-1]
                    for col in ["当日资金流入", "资金流入", "当日净流入"]:
                        if col in df.columns:
                            result["sz"] = round(self._safe_float(latest[col]), 2)
                            break
                    logger.info(f"[市场数据] 深股通: {result['sz']}亿")
            except Exception as e:
                logger.warning(f"[市场数据] 深股通数据获取失败: {e}")

            result["total"] = round(result["sh"] + result["sz"], 2)
            if result["total"] != 0:
                result["status"] = "trading"

            logger.info(f"[市场数据] 北向资金净流入: {result['total']}亿 (沪:{result['sh']} 深:{result['sz']})")

        except Exception as e:
            logger.error(f"[市场数据] 获取北向资金失败: {e}")

        self._set_cache(cache_key, result)
        return result

    def get_main_flow(self) -> dict[str, object]:
        cache_key = "main_flow"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        result = {
            "main_net": 0,
            "super_large": 0,
            "large": 0,
            "medium": 0,
            "small": 0,
            "update_time": datetime.now().strftime("%H:%M:%S"),
        }

        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return result

        try:
            logger.info("[市场数据] 获取主力资金数据...")

            df = self._call_akshare_with_retry(_base.ak.stock_market_fund_flow, "主力资金")

            if df is not None and not df.empty:
                latest = df.iloc[-1]

                super_large = self._safe_float(latest.get("超大单净流入", 0))
                large = self._safe_float(latest.get("大单净流入", 0))
                medium = self._safe_float(latest.get("中单净流入", 0))
                small = self._safe_float(latest.get("小单净流入", 0))

                result["super_large"] = round(super_large / 1e8, 2)
                result["large"] = round(large / 1e8, 2)
                result["medium"] = round(medium / 1e8, 2)
                result["small"] = round(small / 1e8, 2)
                result["main_net"] = round((super_large + large) / 1e8, 2)

                logger.info(f"[市场数据] 主力净流入: {result['main_net']}亿")

        except Exception as e:
            logger.error(f"[市场数据] 获取主力资金失败: {e}")

        self._set_cache(cache_key, result)
        return result

    def get_market_breadth(self) -> dict[str, object]:
        cache_key = "market_breadth"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        result = {
            "up_count": 0,
            "down_count": 0,
            "flat_count": 0,
            "limit_up": 0,
            "limit_down": 0,
            "update_time": datetime.now().strftime("%H:%M:%S"),
        }

        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return result

        try:
            logger.info("[市场数据] 获取市场涨跌统计...")

            df = self._call_akshare_with_retry(_base.ak.stock_zh_a_spot_em, "A股实时行情")
            if (df is None or df.empty) and _base.AKSHARE_AVAILABLE:
                try:
                    df = self._call_akshare_with_retry(_base.ak.stock_zh_a_spot, "A股实时行情(Sina)")
                except Exception:
                    df = None
            if (df is None or df.empty) and EF_AVAILABLE:
                try:
                    df = ef.stock.get_realtime_quotes()
                except Exception:
                    df = None

            if df is not None and not df.empty:
                change_col = "涨跌幅"
                if change_col in df.columns:
                    df[change_col] = _base.pd.to_numeric(df[change_col], errors="coerce")

                    result["up_count"] = len(df[df[change_col] > 0])
                    result["down_count"] = len(df[df[change_col] < 0])
                    result["flat_count"] = len(df[df[change_col] == 0])

                    result["limit_up"] = len(df[df[change_col] >= 9.9])
                    result["limit_down"] = len(df[df[change_col] <= -9.9])

                logger.info(
                    f"[市场数据] 涨:{result['up_count']} 跌:{result['down_count']} "
                    f"涨停:{result['limit_up']} 跌停:{result['limit_down']}"
                )

        except Exception as e:
            logger.error(f"[市场数据] 获取市场广度失败: {e}")

        self._set_cache(cache_key, result)
        return result

    def get_limit_up_stocks(self, limit: int = 10) -> list[dict[str, object]]:
        cache_key = f"limit_up_stocks_{limit}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        stocks = []

        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return stocks

        try:
            logger.info("[市场数据] 获取涨停股票...")

            today = datetime.now().strftime("%Y%m%d")
            df = self._call_akshare_with_retry(lambda: _base.ak.stock_zt_pool_em(date=today), "涨停股池")

            if df is not None and not df.empty:
                for _, row in df.head(limit).iterrows():
                    stock = {
                        "code": str(row.get("代码", "")),
                        "name": str(row.get("名称", "")),
                        "price": self._safe_float(row.get("最新价", 0)),
                        "change_pct": self._safe_float(row.get("涨跌幅", 0)),
                        "amount": round(self._safe_float(row.get("成交额", 0)) / 1e8, 2),
                        "reason": str(row.get("涨停原因", "")),
                        "first_time": str(row.get("首次封板时间", "")),
                        "last_time": str(row.get("最后封板时间", "")),
                        "open_count": int(self._safe_float(row.get("炸板次数", 0))),
                        "continuous_days": int(self._safe_float(row.get("连板数", 1))),
                    }
                    stocks.append(stock)

                logger.info(f"[市场数据] 获取到 {len(stocks)} 只涨停股票")

        except Exception as e:
            logger.error(f"[市场数据] 获取涨停股票失败: {e}")

        self._set_cache(cache_key, stocks)
        return stocks
