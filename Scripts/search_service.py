"""
MyBot 搜索服务模块
"""

import datetime
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from itertools import cycle

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """搜索结果数据类"""

    title: str
    snippet: str
    url: str
    source: str
    published_date: str | None = None

    def to_text(self) -> str:
        date_str = f" ({self.published_date})" if self.published_date else ""
        return f"【{self.source}】{self.title}{date_str}\n{self.snippet}"


@dataclass
class SearchResponse:
    """搜索响应"""

    query: str
    results: list[SearchResult]
    provider: str
    success: bool = True
    error_message: str | None = None
    search_time: float = 0.0

    def to_context(self, max_results: int = 5) -> str:
        if not self.success or not self.results:
            return f"搜索 '{self.query}' 未找到相关结果。"

        lines = [f"【{self.query} 搜索结果】（来源：{self.provider}）"]
        for i, result in enumerate(self.results[:max_results], 1):
            lines.append(f"\n{i}. {result.to_text()}")
        return "\n".join(lines)


class BaseSearchProvider(ABC):
    """搜索引擎基类"""

    def __init__(self, api_keys: list[str], name: str):
        self._api_keys = api_keys
        self._name = name
        self._key_cycle = cycle(api_keys) if api_keys else None
        self._key_errors: dict[str, int] = {key: 0 for key in api_keys}

    @property
    def name(self) -> str:
        return self._name

    @property
    def is_available(self) -> bool:
        return bool(self._api_keys)

    def _get_next_key(self) -> str | None:
        if not self._key_cycle:
            return None
        for _ in range(len(self._api_keys)):
            key = next(self._key_cycle)
            if self._key_errors.get(key, 0) < 3:
                return key
        # Reset errors if all failed
        self._key_errors = {key: 0 for key in self._api_keys}
        return self._api_keys[0] if self._api_keys else None

    def _record_error(self, key: str) -> None:
        self._key_errors[key] = self._key_errors.get(key, 0) + 1

    @abstractmethod
    def _do_search(self, query: str, api_key: str, max_results: int) -> SearchResponse:
        pass

    def search(self, query: str, max_results: int = 5) -> SearchResponse:
        api_key = self._get_next_key()
        if not api_key:
            return SearchResponse(query, [], self._name, False, f"{self._name} 未配置 API Key")

        start_time = time.time()
        try:
            response = self._do_search(query, api_key, max_results)
            response.search_time = time.time() - start_time
            if not response.success:
                self._record_error(api_key)
            return response
        except Exception as e:
            self._record_error(api_key)
            return SearchResponse(query, [], self._name, False, str(e), time.time() - start_time)


class TavilySearchProvider(BaseSearchProvider):
    def __init__(self, api_keys: list[str]):
        super().__init__(api_keys, "Tavily")

    def _do_search(self, query: str, api_key: str, max_results: int) -> SearchResponse:
        try:
            from tavily import TavilyClient

            client = TavilyClient(api_key=api_key)
            response = client.search(query=query, search_depth="basic", max_results=max_results, days=3)
            results = []
            for item in response.get("results", []):
                results.append(
                    SearchResult(
                        title=item.get("title", ""),
                        snippet=item.get("content", "")[:500],
                        url=item.get("url", ""),
                        source=self._extract_domain(item.get("url", "")),
                        published_date=item.get("published_date"),
                    )
                )
            return SearchResponse(query, results, self.name, True)
        except Exception as e:
            return SearchResponse(query, [], self.name, False, str(e))

    @staticmethod
    def _extract_domain(url: str) -> str:
        try:
            from urllib.parse import urlparse

            return urlparse(url).netloc.replace("www.", "") or "未知来源"
        except Exception:
            return "未知来源"


class SerpAPISearchProvider(BaseSearchProvider):
    def __init__(self, api_keys: list[str]):
        super().__init__(api_keys, "SerpAPI")

    def _do_search(self, query: str, api_key: str, max_results: int) -> SearchResponse:
        try:
            from serpapi import GoogleSearch

            params = {"engine": "baidu", "q": query, "api_key": api_key}
            search = GoogleSearch(params)
            response = search.get_dict()
            results = []
            for item in response.get("organic_results", [])[:max_results]:
                results.append(
                    SearchResult(
                        title=item.get("title", ""),
                        snippet=item.get("snippet", "")[:500],
                        url=item.get("link", ""),
                        source=self._extract_domain(item.get("link", "")),
                        published_date=item.get("date"),
                    )
                )
            return SearchResponse(query, results, self.name, True)
        except Exception as e:
            return SearchResponse(query, [], self.name, False, str(e))

    @staticmethod
    def _extract_domain(url: str) -> str:
        try:
            from urllib.parse import urlparse

            return urlparse(url).netloc.replace("www.", "") or "未知来源"
        except Exception:
            return "未知来源"


class BochaSearchProvider(BaseSearchProvider):
    def __init__(self, api_keys: list[str]):
        super().__init__(api_keys, "Bocha")

    def _do_search(self, query: str, api_key: str, max_results: int) -> SearchResponse:
        try:
            import requests

            url = "https://api.bocha.cn/v1/web-search"
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {"query": query, "freshness": "oneMonth", "summary": True, "count": min(max_results, 10)}
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            if response.status_code != 200:
                return SearchResponse(query, [], self.name, False, f"HTTP {response.status_code}")

            data = response.json()
            if data.get("code") != 200:
                return SearchResponse(query, [], self.name, False, data.get("msg"))

            results = []
            for item in data.get("data", {}).get("webPages", {}).get("value", [])[:max_results]:
                results.append(
                    SearchResult(
                        title=item.get("name", ""),
                        snippet=item.get("summary") or item.get("snippet", "")[:500],
                        url=item.get("url", ""),
                        source=item.get("siteName") or self._extract_domain(item.get("url", "")),
                        published_date=item.get("datePublished"),
                    )
                )
            return SearchResponse(query, results, self.name, True)
        except Exception as e:
            return SearchResponse(query, [], self.name, False, str(e))

    @staticmethod
    def _extract_domain(url: str) -> str:
        try:
            from urllib.parse import urlparse

            return urlparse(url).netloc.replace("www.", "") or "未知来源"
        except Exception:
            return "未知来源"


class DuckDuckGoSearchProvider(BaseSearchProvider):
    def __init__(self):
        super().__init__([], "DuckDuckGo")

    @property
    def is_available(self) -> bool:
        return True

    def _do_search(self, query: str, api_key: str, max_results: int) -> SearchResponse:
        try:
            from duckduckgo_search import DDGS

            biased_query = f"{query} {datetime.datetime.now().year}年"
            with DDGS() as ddgs:
                raw = list(ddgs.text(biased_query, region="cn-zh", max_results=max_results))
            results = []
            for item in raw:
                results.append(
                    SearchResult(
                        title=item.get("title", ""),
                        snippet=item.get("body", "")[:500],
                        url=item.get("href", ""),
                        source=self._extract_domain(item.get("href", "")),
                        published_date=item.get("date"),
                    )
                )
            return SearchResponse(query, results, self.name, bool(results))
        except ImportError:
            return SearchResponse(query, [], self.name, False,
                                  "DuckDuckGo 搜索不可用：请安装 duckduckgo-search 包 (pip install duckduckgo-search)")
        except Exception as e:
            return SearchResponse(query, [], self.name, False, str(e))

    @staticmethod
    def _extract_domain(url: str) -> str:
        try:
            from urllib.parse import urlparse
            return urlparse(url).netloc.replace("www.", "") or "未知来源"
        except Exception:
            return "未知来源"


class SearchService:
    def __init__(self, bocha_keys=None, tavily_keys=None, serpapi_keys=None):
        self._providers = []
        if bocha_keys:
            self._providers.append(BochaSearchProvider(bocha_keys))
        if tavily_keys:
            self._providers.append(TavilySearchProvider(tavily_keys))
        if serpapi_keys:
            self._providers.append(SerpAPISearchProvider(serpapi_keys))
        self._providers.append(DuckDuckGoSearchProvider())

    @property
    def is_available(self) -> bool:
        return any(p.is_available for p in self._providers)

    def search(self, query: str, max_results: int = 5) -> SearchResponse:
        """通用搜索方法"""
        for provider in self._providers:
            if provider.is_available:
                response = provider.search(query, max_results)
                if response.success and response.results:
                    return response
        return SearchResponse(query, [], "None", False, "所有搜索引擎都不可用")

    def search_fund_news(self, fund_name: str, fund_code: str, max_results: int = 5) -> SearchResponse:
        query = f"{fund_name} {fund_code} 基金 最新消息 2026年"
        return self.search(query, max_results)


_search_service = None


def get_search_service() -> SearchService:
    global _search_service
    if _search_service is None:
        from config import get_config

        config = get_config()
        _search_service = SearchService(
            bocha_keys=config.bocha_api_keys, tavily_keys=config.tavily_api_keys, serpapi_keys=config.serpapi_keys
        )
    return _search_service
