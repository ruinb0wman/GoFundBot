from .base import MarketDataServiceBase, MarketIndex, MarketOverview, _ensure_akshare
from .indices import IndicesMixin
from .market import MarketMixin
from .sectors import SectorsMixin


class MarketDataService(MarketDataServiceBase, IndicesMixin, MarketMixin, SectorsMixin):
    pass


_market_data_service_instance = None


def get_market_data_service() -> MarketDataService:
    global _market_data_service_instance
    if _market_data_service_instance is None:
        _market_data_service_instance = MarketDataService()
    return _market_data_service_instance


__all__ = [
    "MarketIndex",
    "MarketOverview",
    "MarketDataService",
    "get_market_data_service",
]
