"""ServiceClient – unified HTTP client for the DataService backend.

All Backend external finance-data access MUST go through this client.
The client never parses third-party APIs directly; it only understands
DataService's unified response envelope.
"""

import os
import re
from collections.abc import Iterable
from typing import Any

import requests


class ServiceError(Exception):
    """Unified exception wrapping DataService call failures."""

    def __init__(
        self,
        message: str,
        code: str = "DATA_SERVICE_ERROR",
        status_code: int = 502,
        detail: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.detail = detail or {}
        self.payload = payload

    def to_payload(self) -> dict[str, Any]:
        if self.payload is not None:
            return self.payload

        return {
            "success": False,
            "error": {
                "code": self.code,
                "message": self.message,
                "detail": self.detail,
            },
        }


class ServiceClient:
    """HTTP client for the DataService unified data gateway.

    Configuration:
      DATA_SERVICE_BASE_URL  – base URL (default http://localhost:3100/api)
      DATA_SERVICE_TIMEOUT   – request timeout in seconds (default 5)
    """

    def __init__(self, base_url: str | None = None, timeout: float | None = None):
        self.base_url = (base_url or os.getenv("DATA_SERVICE_BASE_URL") or "http://localhost:3100/api").rstrip("/")
        self.timeout = timeout if timeout is not None else float(os.getenv("DATA_SERVICE_TIMEOUT", "5"))
        self.session = requests.Session()

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    def health(self) -> dict[str, Any]:
        return self._get("/health")

    # ------------------------------------------------------------------
    # Fund – estimate
    # ------------------------------------------------------------------

    def get_fund_estimate(self, code: str) -> dict[str, Any]:
        return self._get(f"/funds/{code}/estimate")

    def get_fund_estimates(self, codes: Iterable[str]) -> dict[str, Any]:
        codes_value = ",".join(str(code) for code in codes)
        return self._get("/funds/estimates", params={"codes": codes_value})

    # ------------------------------------------------------------------
    # Fund – search
    # ------------------------------------------------------------------

    def search_funds(self, keyword: str) -> dict[str, Any]:
        return self._get("/funds/search", params={"q": keyword})

    # ------------------------------------------------------------------
    # Fund – basic
    # ------------------------------------------------------------------

    def get_fund_basic(self, code: str) -> dict[str, Any]:
        return self._get(f"/funds/{code}/basic")

    def get_fund_screening_snapshot(
        self,
        types: Iterable[str] | None = None,
        page_size: int = 500,
        sort: str = "1nzf",
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "pageSize": str(page_size),
            "sort": sort,
        }
        if types:
            params["types"] = ",".join(str(item) for item in types if str(item).strip())
        return self._get("/funds/screening-snapshot", params=params, timeout=20.0)

    # ------------------------------------------------------------------
    # Fund – detail (aggregated)
    # ------------------------------------------------------------------

    def get_fund_detail(self, code: str) -> dict[str, Any]:
        return self._get(f"/funds/{code}/detail", timeout=20.0)

    # ------------------------------------------------------------------
    # Fund – nav / rank / dividends
    # ------------------------------------------------------------------

    def get_fund_nav_history(
        self,
        code: str,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, Any]:
        params = self._drop_none(
            {
                "startDate": start_date,
                "endDate": end_date,
            }
        )
        return self._get(f"/funds/{code}/nav-history", params=params)

    def get_fund_rank_history(self, code: str) -> dict[str, Any]:
        return self._get(f"/funds/{code}/rank-history")

    def get_fund_dividends(self, code: str) -> dict[str, Any]:
        return self._get(f"/funds/{code}/dividends", timeout=20.0)

    # ------------------------------------------------------------------
    # Fund – holdings / managers / asset allocation
    # ------------------------------------------------------------------

    def get_fund_holdings(self, code: str) -> dict[str, Any]:
        return self._get(f"/funds/{code}/holdings")

    def get_fund_managers(self, code: str) -> dict[str, Any]:
        return self._get(f"/funds/{code}/managers")

    def get_fund_asset_allocation(self, code: str) -> dict[str, Any]:
        return self._get(f"/funds/{code}/asset-allocation")

    # ------------------------------------------------------------------
    # Stock – reference
    # ------------------------------------------------------------------

    def get_stock_reference(self, code: str) -> dict[str, Any]:
        return self._get(f"/stocks/{code}/reference")

    def get_stock_references(self, codes: Iterable[str]) -> dict[str, Any]:
        codes_value = ",".join(str(code) for code in codes)
        return self._get("/stocks/references", params={"codes": codes_value})

    # ------------------------------------------------------------------
    # Market – quotes / kline
    # ------------------------------------------------------------------

    def get_market_quotes(self, symbols: Iterable[str] | str) -> dict[str, Any]:
        if isinstance(symbols, str):
            symbols_value = symbols
        else:
            symbols_value = ",".join(symbols)
        return self._get("/market/quotes", params={"symbols": symbols_value})

    def get_market_kline(
        self,
        symbol: str,
        period: str = "daily",
        adjust: str = "none",
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, Any]:
        params = self._drop_none(
            {
                "period": period,
                "adjust": adjust,
                "startDate": start_date,
                "endDate": end_date,
            }
        )
        return self._get(f"/market/kline/{symbol}", params=params)

    # ------------------------------------------------------------------
    # Market – indices
    # ------------------------------------------------------------------

    def get_market_indices(self) -> dict[str, Any]:
        return self._get("/market/indices")

    # ------------------------------------------------------------------
    # Market – sectors
    # ------------------------------------------------------------------

    def get_market_sectors(self) -> dict[str, Any]:
        return self._get("/market/sectors")

    def get_market_sector_constituents(self, code: str) -> dict[str, Any]:
        return self._get(f"/market/sectors/{code}/constituents")

    # ------------------------------------------------------------------
    # Market – money flow (per stock)
    # ------------------------------------------------------------------

    def get_stock_money_flow(self, code: str, days: int = 1) -> dict[str, Any]:
        symbol = self._to_stock_symbol(code)
        return self._get(f"/market/money-flow/{symbol}", params={"days": str(days)})

    # ------------------------------------------------------------------
    # Market – money flow (market-wide aggregate)
    # ------------------------------------------------------------------

    def get_market_money_flow(self) -> dict[str, Any]:
        return self._get("/market/money-flow")

    # ------------------------------------------------------------------
    # Market – breadth
    # ------------------------------------------------------------------

    def get_market_breadth(self) -> dict[str, Any]:
        return self._get("/market/breadth")

    # ------------------------------------------------------------------
    # Market – north flow
    # ------------------------------------------------------------------

    def get_market_north_flow(self) -> dict[str, Any]:
        return self._get("/market/north-flow")

    # ------------------------------------------------------------------
    # Market – global indices
    # ------------------------------------------------------------------

    def get_market_global_indices(self) -> dict[str, Any]:
        return self._get("/market/global-indices")

    # ------------------------------------------------------------------
    # Market – global index kline
    # ------------------------------------------------------------------

    def get_market_global_kline(
        self,
        symbol: str,
        period: str = "daily",
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, Any]:
        params = self._drop_none(
            {
                "period": period,
                "startDate": start_date,
                "endDate": end_date,
            }
        )
        return self._get(f"/market/kline/global/{symbol}", params=params)

    # ------------------------------------------------------------------
    # News – flash news
    # ------------------------------------------------------------------

    def get_flash_news(self, count: int = 30, page: int = 1) -> dict[str, Any]:
        return self._get("/news/flash", params={"count": str(count), "page": str(page)})

    # ------------------------------------------------------------------
    # HTTP transport
    # ------------------------------------------------------------------

    def _get(self, path: str, params: dict[str, Any] | None = None, timeout: float | None = None) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        effective_timeout = timeout if timeout is not None else self.timeout
        try:
            response = self.session.get(url, params=params, timeout=effective_timeout)
        except requests.RequestException as exc:
            raise ServiceError(
                message=str(exc),
                code="DATA_SERVICE_UNAVAILABLE",
                status_code=503,
                detail={"url": url, "params": params or {}},
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise ServiceError(
                message="DataService returned non-JSON response",
                code="DATA_SERVICE_UNAVAILABLE",
                status_code=502,
                detail={"url": url, "status_code": response.status_code},
            ) from exc

        if not isinstance(payload, dict):
            raise ServiceError(
                message="DataService returned invalid JSON payload",
                code="DATA_SERVICE_UNAVAILABLE",
                status_code=502,
                detail={"url": url, "status_code": response.status_code},
            )

        if payload.get("success") is False:
            error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
            raise ServiceError(
                message=str(error.get("message") or "DataService request failed"),
                code=str(error.get("code") or "DATA_SERVICE_ERROR"),
                status_code=response.status_code if response.status_code >= 400 else 502,
                detail=error.get("detail") if isinstance(error.get("detail"), dict) else {},
                payload=payload,
            )

        if response.status_code >= 400:
            raise ServiceError(
                message=f"DataService returned HTTP {response.status_code}",
                code="DATA_SERVICE_UNAVAILABLE",
                status_code=response.status_code,
                detail={"url": url, "status_code": response.status_code},
            )

        return payload

    @staticmethod
    def _drop_none(params: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in params.items() if value is not None}

    @staticmethod
    def _to_stock_symbol(code: str) -> str:
        """Normalize a stock code to DataService symbol format (e.g., sh600519)."""
        code = code.strip()
        if re.match(r"^(sh|sz|bj)", code, re.IGNORECASE):
            return code.lower()
        code = re.sub(r"\.(SH|SZ|BJ|HK)$", "", code, flags=re.IGNORECASE)
        if re.match(r"^\d{6}$", code):
            if code.startswith(("6", "9")):
                return f"sh{code}"
            return f"sz{code}"
        return code.lower()


def get_data_service_client() -> ServiceClient:
    """Convenience factory reading config from environment variables."""
    return ServiceClient()
