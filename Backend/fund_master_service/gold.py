# -*- coding: UTF-8 -*-
"""
Fund-Master 贵金属价格模块
"""

import datetime
import json
import time

import requests

from core.logging import get_logger

logger = get_logger(__name__)


class FundMasterServiceGoldMixin:
    """Mixin: 贵金属价格"""

    def get_gold_realtime(self) -> dict:
        """
        获取实时贵金属价格
        数据源：金投网/集金号

        Returns:
            dict: {'success': bool, 'data': list, 'update_time': str}
        """
        cache_key = "gold_realtime"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        try:
            headers = {
                "accept": "*/*",
                "referer": "https://quote.cngold.org/gjs/gjhj.html",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
            }

            url = "https://api.jijinhao.com/quoteCenter/realTime.htm"
            params = {"codes": "JO_71,JO_92233,JO_92232,JO_75", "_": str(int(time.time() * 1000))}

            response = requests.get(url, headers=headers, params=params, timeout=10, verify=False)
            raw = response.text.replace("var quote_json = ", "")
            data = json.loads(raw)

            result = []
            if data:
                code_map = {"JO_71": "黄金T+D", "JO_92233": "国际黄金", "JO_92232": "国际白银", "JO_75": "白银T+D"}

                for code in ["JO_71", "JO_92233", "JO_92232"]:
                    if code in data:
                        d = data[code]
                        update_time = ""
                        if d.get("time"):
                            update_time = datetime.datetime.fromtimestamp(d["time"] / 1000).strftime(
                                "%Y-%m-%d %H:%M:%S"
                            )

                        result.append(
                            {
                                "name": d.get("showName", code_map.get(code, code)),
                                "price": round(d.get("q63", 0), 2),
                                "change": round(d.get("q70", 0), 2),
                                "change_pct": f"{round(d.get('q80', 0), 2)}%",
                                "open": round(d.get("q1", 0), 2),
                                "high": round(d.get("q3", 0), 2),
                                "low": round(d.get("q4", 0), 2),
                                "prev_close": round(d.get("q2", 0), 2),
                                "update_time": update_time,
                                "unit": d.get("unit", ""),
                            }
                        )

            data = {
                "success": True,
                "data": result,
                "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            self._set_cache(cache_key, data, "gold_realtime")
            return data

        except Exception as e:
            return {"success": False, "error": str(e), "data": []}

    def _fetch_metal_history(self, code: str, days: int, need_field: str = "128,129,70") -> dict | None:
        try:
            headers = {
                "accept": "*/*",
                "referer": "https://quote.cngold.org/gjs/swhj_zghj.html",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            }
            url = "https://api.jijinhao.com/quoteCenter/history.htm"
            params = {
                "code": code,
                "style": "3",
                "pageSize": str(days),
                "needField": need_field,
                "currentPage": "1",
                "_": int(time.time() * 1000),
            }
            response = requests.get(url, headers=headers, params=params, timeout=10, verify=False)
            parsed = json.loads(response.text.replace("var quote_json = ", ""))
            return parsed
        except Exception:
            return None

    def get_gold_history(self, days: int = 10) -> dict:
        """
        获取黄金历史价格
        数据源：金投网/集金号

        Args:
            days: 获取天数，默认10天

        Returns:
            dict: {'success': bool, 'data': list, 'update_time': str}
        """
        cache_key = f"gold_history_{days}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        try:
            data1_data = self._fetch_metal_history("JO_52683", days)
            data2_data = self._fetch_metal_history("JO_42660", days)
            if data1_data is None:
                raise RuntimeError("gold history API failed")
            data1 = data1_data.get("data", [])
            data2 = data2_data.get("data", []) if data2_data else []

            result = []
            for i in range(len(data1)):
                gold = data1[i]
                t = gold.get("time", 0)
                date = datetime.datetime.fromtimestamp(t / 1000).strftime("%Y-%m-%d") if t else ""

                gold2 = data2[i] if i < len(data2) else {}

                result.append(
                    {
                        "date": date,
                        "china_gold_price": gold.get("q1", "N/A"),
                        "china_gold_change": str(gold.get("q70", "N/A")),
                        "zhoudafu_price": gold2.get("q1", "N/A"),
                        "zhoudafu_change": str(gold2.get("q70", "N/A")),
                    }
                )

            data = {
                "success": True,
                "data": result,
                "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            self._set_cache(cache_key, data, "gold_history")
            return data

        except Exception as e:
            return {"success": False, "error": str(e), "data": []}

    def get_silver_history(self, days: int = 10) -> dict:
        """
        获取现货白银历史价格
        数据源：金投网/集金号

        Args:
            days: 获取天数，默认10天

        Returns:
            dict: {'success': bool, 'data': list, 'update_time': str}
        """
        cache_key = f"silver_history_{days}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        try:
            parsed = self._fetch_metal_history("JO_92232", days, need_field="70")
            if parsed is None:
                raise RuntimeError("silver history API failed")
            raw = parsed.get("data", [])
            unit = parsed.get("unit", "美元/盎司")

            result = []
            for item in raw:
                t = item.get("time", 0)
                date = datetime.datetime.fromtimestamp(t / 1000).strftime("%Y-%m-%d") if t else ""
                result.append(
                    {
                        "date": date,
                        "price": item.get("q1", "N/A"),
                        "change": str(item.get("q70", "N/A")),
                        "high": item.get("q3", "N/A"),
                        "low": item.get("q4", "N/A"),
                        "volume": item.get("q60", 0),
                        "unit": unit,
                    }
                )

            data = {
                "success": True,
                "data": result,
                "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            self._set_cache(cache_key, data, "silver_history")
            return data

        except Exception as e:
            return {"success": False, "error": str(e), "data": []}
