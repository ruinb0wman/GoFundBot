# -*- coding: UTF-8 -*-
"""
Fund-Master 市场指数分时数据模块
"""

import datetime
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from core.logging import get_logger

logger = get_logger(__name__)


class FundMasterServiceIntradayMixin:
    """Mixin: 市场指数分时数据"""

    def _get_sina_intraday(self, code: str) -> list:
        """
        获取新浪财经5分钟K线数据作为分时走势
        code: sh000001 (上证), sz399001 (深证), sh000300 (沪深300)
        """
        try:
            url = "https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_s=/CN_MarketDataService.getKLineData"
            params = {"symbol": code, "scale": "5", "ma": "no", "datalen": "240"}
            headers = {
                "Referer": "https://finance.sina.com.cn/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            }
            response = requests.get(url, params=params, headers=headers, timeout=8)
            text = response.text

            json_start = text.find("([")
            json_end = text.rfind("])")
            if json_start < 0 or json_end < 0:
                return []
            json_str = text[json_start + 1 : json_end + 1]
            data = json.loads(json_str)

            pre_close = 0
            index_cache = self._get_cache("market_index")
            if index_cache and index_cache.get("data"):
                for item in index_cache["data"]:
                    if item.get("code") == code:
                        pre_close = item.get("prev_close", 0) or 0
                        break

            result = []
            for point in data:
                day = point.get("day", "")
                close_price = float(point.get("close", 0))
                volume = point.get("volume", "-")

                time_part = day.split(" ")[-1] if " " in day else day
                time_str = time_part[:5]

                change = 0
                change_pct = "0.00%"
                if pre_close:
                    change = round(close_price - pre_close, 2)
                    pct = (change / pre_close) * 100
                    change_pct = f"{round(pct, 2)}%"

                result.append(
                    {
                        "time": time_str,
                        "price": str(close_price),
                        "change": f"{'+' if change > 0 else ''}{change}",
                        "change_pct": change_pct,
                        "volume": str(volume),
                    }
                )
            return result
        except Exception as e:
            logger.error(f"Error fetching sina intraday for {code}: {e}")
            return []

    def get_indices_intraday(self) -> dict:
        """
        获取多指数分时数据（上证、深证、沪深300）
        数据源：新浪财经5分钟K线（quotes.sina.cn，比腾讯快10x+）

        Returns:
            dict: {'sh': [], 'sz': [], 'hs300': [], 'update_time': str}
        """
        cache_key = "indices_intraday"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        self.get_market_index()

        targets = {
            "sh": "sh000001",
            "sz": "sz399001",
            "hs300": "sh000300",
        }
        intraday = {key: [] for key in targets}
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {executor.submit(self._get_sina_intraday, code): key for key, code in targets.items()}
            for future in as_completed(futures):
                key = futures[future]
                try:
                    intraday[key] = future.result(timeout=5)
                except Exception as e:
                    logger.error(f"Error fetching intraday index {key}: {e}")

        data = {
            "success": True,
            "data": {"sh": intraday["sh"], "sz": intraday["sz"], "hs300": intraday["hs300"]},
            "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        self._set_cache(cache_key, data, "sse_30min")
        return data

    def get_sse_30min(self) -> dict:
        """
        获取上证指数分时数据（兼容旧接口，但提供全天数据）
        """
        full_data = self.get_indices_intraday()
        if full_data["success"]:
            return {"success": True, "data": full_data["data"]["sh"], "update_time": full_data["update_time"]}
        return {"success": False, "error": "获取上证指数数据失败", "data": []}

    def _get_sector_rank_via_service(self, limit: int = 500) -> dict:
        """通过 MarketDataService 获取板块（同花顺源），失败时降级到 FundMasterService"""
        try:
            from services.market_data import get_market_data_service as get_mds

            return get_mds().get_industry_boards(page_size=limit)
        except Exception:
            return self.get_sector_rank(limit=limit)
