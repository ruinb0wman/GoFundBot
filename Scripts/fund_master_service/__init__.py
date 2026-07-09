# -*- coding: UTF-8 -*-
"""
Fund-Master 核心功能服务模块 — 包入口
合并所有 mixin 子模块为完整的 FundMasterService 类。
"""

from fund_master_service.base import FundMasterServiceBase
from fund_master_service.gold import FundMasterServiceGoldMixin
from fund_master_service.intraday import FundMasterServiceIntradayMixin
from fund_master_service.market_index import FundMasterServiceMarketIndexMixin
from fund_master_service.news import FundMasterServiceNewsMixin
from fund_master_service.overview import FundMasterServiceOverviewMixin
from fund_master_service.sector import FundMasterServiceSectorMixin
from fund_master_service.volume import FundMasterServiceVolumeMixin


class FundMasterService(
    FundMasterServiceBase,
    FundMasterServiceNewsMixin,
    FundMasterServiceSectorMixin,
    FundMasterServiceMarketIndexMixin,
    FundMasterServiceGoldMixin,
    FundMasterServiceVolumeMixin,
    FundMasterServiceIntradayMixin,
    FundMasterServiceOverviewMixin,
):
    """Fund-Master 核心数据服务（完整类）"""

    pass


# 全局单例
_fund_master_service = None


def get_fund_master_service() -> FundMasterService:
    """获取 FundMasterService 单例"""
    global _fund_master_service
    if _fund_master_service is None:
        _fund_master_service = FundMasterService()
    return _fund_master_service
