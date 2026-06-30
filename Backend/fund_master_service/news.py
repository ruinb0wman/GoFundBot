# -*- coding: UTF-8 -*-
"""
Fund-Master 7x24快讯模块
"""

import datetime
import html
import json
import re

from core.logging import get_logger

logger = get_logger(__name__)


class FundMasterServiceNewsMixin:
    """Mixin: 7x24快讯"""

    def get_flash_news(self, count: int = 20) -> dict:
        """
        获取7x24小时快讯
        数据源：百度股市通

        Args:
            count: 获取快讯数量，默认20条

        Returns:
            dict: {'success': bool, 'data': list, 'update_time': str}
        """
        cache_key = f"flash_news_{count}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        errors = []
        merged = []
        fetch_count = max(count * 2, 40)
        for source in (
            self._fetch_baidu_flash_news,
            self._fetch_eastmoney_flash_news,
            self._fetch_cls_flash_news,
        ):
            try:
                merged.extend(source(fetch_count))
            except Exception as e:
                errors.append(self._short_error(e))

        result = self._dedupe_sort_news(merged)[:count]
        if result:
            data = {
                "success": True,
                "data": result,
                "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "sources": list(sorted({item.get("source", "") for item in result if item.get("source")})),
            }
            self._set_cache(cache_key, data, "flash_news")
            return data

        stale = self._get_stale_cache(cache_key)
        if stale and stale.get("data"):
            return {**stale, "source": "stale_cache"}
        return {"success": False, "error": "；".join(errors) or "获取快讯失败", "data": []}

    def _news_time_to_text(self, value):
        if not value:
            return ""
        try:
            if isinstance(value, (int, float)) or str(value).isdigit():
                ts = int(value)
                if ts > 10_000_000_000:
                    ts = ts // 1000
                return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass
        text = str(value).strip()
        if re.match(r"^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}", text):
            return text if len(text.split(":")) >= 3 else f"{text}:00"
        if re.match(r"^\d{1,2}:\d{1,2}", text):
            return f"{datetime.datetime.now().strftime('%Y-%m-%d')} {text}:00"
        return text

    def _normalize_news_title(self, title):
        text = html.unescape(str(title or ""))
        text = re.sub(r"<[^>]+>", "", text)
        return re.sub(r"\s+", " ", text).strip()

    def _dedupe_sort_news(self, items):
        seen = set()
        result = []
        for item in items:
            title = self._normalize_news_title(item.get("title"))
            if not title:
                continue
            key = re.sub(r"[^\w\u4e00-\u9fff]+", "", title.lower())[:80]
            if key in seen:
                continue
            seen.add(key)
            result.append(
                {
                    "title": title,
                    "evaluate": item.get("evaluate", ""),
                    "publish_time": self._news_time_to_text(item.get("publish_time")),
                    "related_stocks": item.get("related_stocks") or [],
                    "source": item.get("source", ""),
                }
            )

        def sort_key(item):
            try:
                return datetime.datetime.strptime((item.get("publish_time") or "")[:19], "%Y-%m-%d %H:%M:%S")
            except Exception:
                return datetime.datetime.min

        return sorted(result, key=sort_key, reverse=True)

    def _fetch_baidu_flash_news(self, count):
        url = f"https://finance.pae.baidu.com/selfselect/expressnews?rn={count}&pn=0&tag=A股&finClientType=pc"
        response = self.baidu_session.get(url, timeout=10, verify=False)
        payload = response.json()
        if payload.get("ResultCode") != "0":
            return []
        news_list = payload.get("Result", {}).get("content", {}).get("list", [])
        result = []
        for item in news_list:
            title = item.get("title", "")
            if not title and item.get("content", {}).get("items"):
                title = item["content"]["items"][0].get("data", "")
            entities = item.get("entity", [])
            related_stocks = [
                {
                    "code": e.get("code", "").strip(),
                    "name": e.get("name", "").strip(),
                    "ratio": e.get("ratio", "").strip(),
                }
                for e in entities
                if e.get("code")
            ]
            result.append(
                {
                    "title": title,
                    "evaluate": item.get("evaluate", ""),
                    "publish_time": item.get("publish_time", ""),
                    "related_stocks": related_stocks,
                    "source": "百度股市通",
                }
            )
        return result

    def _fetch_eastmoney_flash_news(self, count):
        url = f"https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_{count}_1_.html"
        response = self.session.get(
            url,
            headers={
                "Referer": "https://kuaixun.eastmoney.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout=8,
            verify=False,
        )
        response.raise_for_status()
        text = response.text.strip()
        match = re.search(r"ajaxResult\s*=\s*(\{.*\})\s*;?\s*$", text, re.S)
        payload = json.loads(match.group(1) if match else text)
        news_list = payload.get("LivesList") or payload.get("data") or payload.get("list") or []
        result = []
        for item in news_list:
            result.append(
                {
                    "title": item.get("title") or item.get("digest") or item.get("simtitle"),
                    "evaluate": "",
                    "publish_time": item.get("showtime") or item.get("time") or item.get("ctime"),
                    "related_stocks": [],
                    "source": "东方财富",
                }
            )
        return result

    def _fetch_cls_flash_news(self, count):
        payload = self._get_json(
            "https://www.cls.cn/nodeapi/telegraphList",
            params={
                "app": "CailianpressWeb",
                "category": "",
                "lastTime": "",
                "last_time": "",
                "os": "web",
                "refresh_type": "1",
                "rn": str(count),
                "sv": "8.4.6",
            },
            headers={
                "Referer": "https://www.cls.cn/telegraph",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout=8,
        )
        data = payload.get("data") or {}
        news_list = data.get("roll_data") or data.get("telegram") or data.get("list") or []
        result = []
        for item in news_list:
            result.append(
                {
                    "title": item.get("content") or item.get("title") or item.get("brief"),
                    "evaluate": "",
                    "publish_time": item.get("ctime") or item.get("time") or item.get("created_at"),
                    "related_stocks": [],
                    "source": "财联社",
                }
            )
        return result
