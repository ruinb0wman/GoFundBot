# -*- coding: UTF-8 -*-
# DEPRECATED:
# This module is kept as fallback during the DataService migration.
# New external financial data access should be implemented in DataService providers.
# Do not add new third-party data source calls here.
# Target replacement: DataService marketService / newsService / EastMoneyMarketProvider.

"""
Fund-Master 核心功能服务模块 — 基础基础设施
包含：HTTP会话管理、内存缓存、工具方法
"""

import contextlib
import datetime
import threading
import time

import requests
import urllib3

from core.logging import get_logger
from core.request import get_eastmoney_circuit_breaker

logger = get_logger(__name__)

try:
    from curl_cffi import requests as curl_requests

    CURL_CFFI_AVAILABLE = True
except ImportError:
    CURL_CFFI_AVAILABLE = False
    curl_requests = None

urllib3.disable_warnings()


class FundMasterServiceBase:
    """Fund-Master 核心数据服务 — 基础基础设施"""

    # 内存缓存（带过期时间）
    _cache = {}
    _cache_lock = threading.Lock()

    # 缓存过期时间配置（秒）
    CACHE_TTL = {
        "flash_news": 30,
        "sector_rank": 300,
        "market_index": 60,
        "gold_realtime": 60,
        "gold_history": 3600,
        "silver_history": 3600,
        "a_volume_7days": 300,
        "sse_30min": 60,
    }

    def __init__(self):
        self.session = requests.Session()
        self.session.trust_env = False
        self.baidu_session = None
        self._init_baidu_session()

    def _safe_float(self, value, default=0.0):
        try:
            if value in (None, "", "-", "--"):
                return default
            return float(value)
        except (TypeError, ValueError):
            return default

    def _get_json(self, url, params=None, headers=None, timeout=10):
        """获取 JSON 数据，依次尝试多种网络会话以适配不同网络环境"""
        cb = get_eastmoney_circuit_breaker()
        is_em = cb._is_eastmoney_url(url)
        if is_em and cb.is_open(url):
            raise Exception("East Money 熔断器已打开，跳过请求")

        errors = []

        candidates = []
        env_session = requests.Session()
        env_session.trust_env = True
        candidates.append(env_session)
        candidates.append(self.session)

        for session in candidates:
            try:
                response = session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=timeout,
                    verify=False,
                )
                response.raise_for_status()
                if is_em:
                    cb.record_success(url)
                return response.json()
            except Exception as exc:
                errors.append(exc)

        if CURL_CFFI_AVAILABLE:
            try:
                response = curl_requests.get(
                    url, params=params, headers=headers, timeout=timeout, verify=False, impersonate="chrome"
                )
                response.raise_for_status()
                if is_em:
                    cb.record_success(url)
                return response.json()
            except Exception as exc:
                errors.append(exc)

        if is_em:
            cb.record_failure(url)
        raise errors[-1]

    def _short_error(self, error):
        message = str(error)
        if "ProxyError" in message:
            return "市场数据源代理连接失败"
        if "timed out" in message.lower() or "timeout" in message.lower():
            return "市场数据源请求超时"
        if "Connection" in message or "connect" in message.lower():
            return "市场数据源连接失败"
        return message[:120]

    def _init_baidu_session(self):
        """初始化百度股市通会话（使用 curl_cffi 绕过反爬）"""
        if CURL_CFFI_AVAILABLE:
            self.baidu_session = curl_requests.Session(impersonate="chrome")
            self.baidu_session.headers = {
                "accept": "application/vnd.finance-web.v1+json",
                "accept-language": "zh-CN,zh;q=0.9",
                "origin": "https://gushitong.baidu.com",
                "referer": "https://gushitong.baidu.com/",
                "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            }
            with contextlib.suppress(Exception):
                self.baidu_session.get(
                    "https://gushitong.baidu.com/index/ab-000001",
                    headers={"user-agent": self.baidu_session.headers["user-agent"]},
                    timeout=10,
                    verify=False,
                )
        else:
            self.baidu_session = self.session

    def _get_cache(self, key: str):
        """获取缓存数据"""
        with self._cache_lock:
            if key in self._cache:
                data, expire_time = self._cache[key]
                if time.time() < expire_time:
                    return data
        return None

    def _get_stale_cache(self, key: str):
        """获取已过期缓存，用于外部数据源短暂不可用时兜底展示。"""
        with self._cache_lock:
            cached = self._cache.get(key)
            return cached[0] if cached else None

    def _set_cache(self, key: str, data, ttl_key: str):
        """设置缓存数据"""
        with self._cache_lock:
            ttl = self.CACHE_TTL.get(ttl_key, 60)
            self._cache[key] = (data, time.time() + ttl)

    def _last_a_share_trading_date(self):
        now = datetime.datetime.now()
        day = now.date()
        minutes = now.hour * 60 + now.minute
        if day.weekday() >= 5 or minutes < 9 * 60 + 30:
            day -= datetime.timedelta(days=1)
        while day.weekday() >= 5:
            day -= datetime.timedelta(days=1)
        return day.strftime("%Y-%m-%d")

    def _is_a_share_trading_time(self):
        now = datetime.datetime.now()
        if now.weekday() >= 5:
            return False
        minutes = now.hour * 60 + now.minute
        return (9 * 60 + 30 <= minutes <= 11 * 60 + 30) or (13 * 60 <= minutes <= 15 * 60)

    def _format_amount_yi(self, value):
        amount = self._safe_float(value, 0.0)
        if not amount:
            return "0亿"
        return f"{round(amount / 100000000, 2)}亿"

    def _format_pct(self, value):
        return f"{round(self._safe_float(value, 0.0), 2)}%"
