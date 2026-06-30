# -*- coding: UTF-8 -*-
"""
Fund-Master 行业板块排行模块
"""

import datetime
import json
import os

from core.logging import get_logger

logger = get_logger(__name__)


class FundMasterServiceSectorMixin:
    """Mixin: 行业板块排行"""

    def _sector_rank_cache_file(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return os.path.join(root, "Data", "sector_rank_cache.json")

    def _save_sector_rank_file_cache(self, data):
        try:
            path = self._sector_rank_cache_file()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        except Exception:
            pass

    def _load_sector_rank_file_cache(self, limit, data_date, require_full=True):
        try:
            path = self._sector_rank_cache_file()
            if not os.path.exists(path):
                return None
            with open(path, encoding="utf-8") as f:
                cached = json.load(f)
            rows = cached.get("data") or []
            if not rows:
                return None
            if any("?" in str(row.get("name") or "") for row in rows):
                return None
            min_expected = min(max(limit, 1), 100)
            if require_full and len(rows) < min_expected:
                return None
            is_full = len(rows) >= min_expected
            return {
                **cached,
                "success": True,
                "data": rows[:limit],
                "source": "file_cache" if is_full else "partial_file_cache",
                "is_stale": True,
                "is_partial": not is_full,
                "data_date": cached.get("data_date") or data_date,
            }
        except Exception:
            return None

    def _is_valid_sector_rank(self, rows):
        if not rows:
            return False
        return any(
            abs(self._safe_float(row.get("raw_change"), 0.0)) > 0.0001
            or abs(self._safe_float(row.get("raw_main_inflow"), 0.0)) > 0.0001
            for row in rows
        )

    def _get_sector_rank_akshare(self, limit):
        if os.environ.get("DISABLE_AKSHARE_FALLBACK") == "1":
            logger.warning("[FundMaster] akshare 被 DISABLE_AKSHARE_FALLBACK 禁用，跳过")
            return []
        try:
            import akshare as ak
        except ImportError as e:
            logger.error(f"[FundMaster] akshare 导入失败（未安装?）: {e}")
            return []
        except Exception as e:
            logger.warning(f"[FundMaster] akshare 导入异常: {e}")
            return []

        candidates = []
        for fn_name in ("stock_board_industry_summary_ths",):
            try:
                fn = getattr(ak, fn_name, None)
                if not fn:
                    logger.info(f"[FundMaster] akshare 未找到函数 {fn_name}")
                    continue
                df = fn()
                if df is None or df.empty:
                    logger.info(f"[FundMaster] akshare {fn_name} 返回空数据")
                    continue
                candidates.append(df)
            except Exception as e:
                logger.error(f"[FundMaster] akshare {fn_name} 调用失败: {e}")
                continue

        if not candidates:
            logger.info("[FundMaster] akshare 所有数据源均无数据")
            return []

        for df in candidates:
            rows = []
            for _, row in df.head(max(min(limit, 120), 80)).iterrows():
                name = row.get("板块名称") or row.get("板块") or row.get("名称")
                if not name:
                    continue
                code = str(row.get("板块代码") or row.get("代码") or row.get("鏉垮潡浠ｇ爜") or row.get("浠ｇ爜") or "")
                if code and not code.startswith("BK"):
                    continue
                change = row.get("涨跌幅")
                if change is None:
                    change = row.get("涨幅") or row.get("涨跌幅/%")
                inflow = row.get("净流入") or row.get("主力净流入") or row.get("净额") or row.get("资金净流入") or 0
                inflow_pct = row.get("主力净流入占比") or row.get("净占比") or 0
                inflow_val = self._safe_float(inflow, 0.0)
                rows.append(
                    {
                        "name": str(name),
                        "code": code,
                        "change_pct": self._format_pct(change),
                        "main_inflow": f"{round(inflow_val, 2)}亿" if inflow_val else "0亿",
                        "main_inflow_pct": self._format_pct(inflow_pct),
                        "raw_change": self._safe_float(change, 0.0),
                        "raw_main_inflow": inflow_val,
                    }
                )
            rows.sort(key=lambda x: x["raw_change"], reverse=True)
            if self._is_valid_sector_rank(rows):
                logger.info(f"[FundMaster] akshare 板块数据获取成功，共 {len(rows)} 条（来源: {fn_name}）")
                return rows[:limit]
            logger.info(f"[FundMaster] akshare {fn_name} 数据被 _is_valid_sector_rank 否决（可能非交易日）")
        logger.error("[FundMaster] akshare 板块数据获取失败或数据无效")
        return []

    def get_sector_rank(self, limit: int = 90) -> dict:
        """
        获取行业板块排行（按涨跌幅排序）
        数据源：同花顺 (akshare.stock_board_industry_summary_ths)

        Args:
            limit: 返回板块数量，默认500

        Returns:
            dict: {'success': bool, 'data': list, 'update_time': str}
        """
        limit = max(1, min(int(limit or 90), 120))
        cache_key = f"sector_rank_{limit}"
        data_date = self._last_a_share_trading_date()

        cached = self._get_cache(cache_key)
        if cached:
            return cached

        akshare_rows = self._get_sector_rank_akshare(limit)
        if akshare_rows:
            data = {
                "success": True,
                "data": akshare_rows,
                "total_count": len(akshare_rows),
                "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "data_date": data_date,
                "is_stale": False,
                "source": "akshare.ths",
            }
            self._set_cache(cache_key, data, "sector_rank")
            self._save_sector_rank_file_cache(data)
            return data

        logger.info("[FundMaster] akshare 无数据，尝试过期缓存...")
        stale = self._get_stale_cache(cache_key)
        if stale and stale.get("data"):
            logger.warning(f"[FundMaster] 使用过期内存缓存，{len(stale['data'])} 条")
            return {**stale, "is_stale": True, "source": "stale_cache"}

        logger.info("[FundMaster] 过期缓存无数据，尝试文件缓存...")
        file_cached = self._load_sector_rank_file_cache(limit, data_date, require_full=False)
        if file_cached:
            logger.info(f"[FundMaster] 使用文件缓存，{len(file_cached.get('data', []))} 条")
            return {**file_cached, "is_stale": True, "source": "file_cache"}

        logger.info("[FundMaster] 文件缓存无数据，使用占位数据")
        fallback_rows = self._get_sector_rank_fallback(limit)
        if fallback_rows:
            return {
                "success": True,
                "data": fallback_rows,
                "total_count": len(fallback_rows),
                "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "data_date": data_date,
                "is_stale": True,
                "is_partial": True,
                "source": "fallback",
            }

        return {"success": False, "error": "获取板块数据失败", "data": []}

    def _get_sector_rank_fallback(self, limit: int = 50) -> list:
        """返回结构稳定的板块占位数据，避免外部数据源故障时前端整块不可用。"""
        names = [
            "银行",
            "证券",
            "保险",
            "房地产开发",
            "半导体",
            "消费电子",
            "汽车整车",
            "医药商业",
            "白酒",
            "电池",
            "光伏设备",
            "通信设备",
            "软件开发",
            "游戏",
            "军工装备",
            "贵金属",
            "煤炭行业",
            "有色金属",
            "电力行业",
            "旅游酒店",
        ]
        result = []
        for name in names[: max(0, limit)]:
            result.append(
                {
                    "name": name,
                    "change_pct": "0.00%",
                    "main_inflow": "0亿",
                    "main_inflow_pct": "0.00%",
                    "raw_change": 0.0,
                    "raw_main_inflow": 0.0,
                }
            )
        return result
