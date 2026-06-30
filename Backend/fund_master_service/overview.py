# -*- coding: UTF-8 -*-
"""
Fund-Master 市场概览模块
"""

import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

from core.logging import get_logger

logger = get_logger(__name__)


class FundMasterServiceOverviewMixin:
    """Mixin: 市场概览（汇总数据接口）"""

    def get_market_overview(self) -> dict:
        """
        获取市场概览（汇总所有关键数据）
        并行调用各子接口，减少串行等待时间

        Returns:
            dict: 包含所有市场数据的汇总
        """
        update_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        results = {}
        tasks = {
            "market_index": self.get_market_index,
            "gold_realtime": self.get_gold_realtime,
            "a_volume_7days": self.get_a_volume_7days,
        }

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(fn): key for key, fn in tasks.items()}
            for future in as_completed(futures):
                key = futures[future]
                try:
                    results[key] = future.result(timeout=30)
                except Exception as e:
                    logger.error(f"[MarketOverview] fetch {key} failed: {e}")
                    results[key] = {"success": False, "error": str(e), "data": []}

        return {
            "success": True,
            "market_index": results.get("market_index"),
            "gold_realtime": results.get("gold_realtime"),
            "a_volume_7days": results.get("a_volume_7days"),
            "update_time": update_time,
        }
