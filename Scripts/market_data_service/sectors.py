import logging

from . import base as _base

logger = logging.getLogger(__name__)


class SectorsMixin:
    def get_hot_sectors(self) -> list[dict[str, object]]:
        cache_key = "hot_sectors"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        sectors = []

        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return sectors

        try:
            logger.info("[市场数据] 获取热门板块...")

            df = None
            if _base.AKSHARE_AVAILABLE:
                try:
                    df = self._call_akshare_with_retry(_base.ak.stock_board_industry_summary_ths, "行业板块(THS)")
                except Exception:
                    df = None
            if df is None or df.empty:
                data = self._fetch_em_json(
                    "https://push2.eastmoney.com/api/qt/clist/get",
                    {
                        "pn": "1",
                        "pz": "50",
                        "po": "1",
                        "np": "1",
                        "fltt": "2",
                        "invt": "2",
                        "fid": "f3",
                        "fs": "m:90 t:2",
                        "fields": "f12,f14,f3,f62",
                    },
                )
                if data and data.get("data") and data["data"].get("diff"):
                    em_rows = data["data"]["diff"]
                    sectors = []
                    for item in sorted(em_rows, key=lambda x: float(x.get("f3") or 0), reverse=True)[:10]:
                        sectors.append(
                            {
                                "code": str(item.get("f12", "")),
                                "name": str(item.get("f14", "")),
                                "change_pct": float(item.get("f3") or 0),
                                "up_count": 0,
                                "down_count": 0,
                                "leader": "",
                                "leader_pct": 0.0,
                                "amount": self._safe_float(item.get("f62", 0)),
                            }
                        )
                    self._set_cache(cache_key, sectors)
                    return sectors

            if df is not None and not df.empty:
                change_col = "涨跌幅"
                if change_col in df.columns:
                    df[change_col] = _base.pd.to_numeric(df[change_col], errors="coerce")
                    df = df.dropna(subset=[change_col])

                    df_sorted = df.sort_values(by=change_col, ascending=False)

                    for _, row in df_sorted.head(10).iterrows():
                        name = row.get("板块名称")
                        if name is None:
                            name = row.get("板块")
                        leader = row.get("领涨股票")
                        if leader is None:
                            leader = row.get("领 涨股")
                        leader_pct = row.get("领涨股票-涨跌幅")
                        if leader_pct is None:
                            leader_pct = row.get("领涨股-涨跌幅")
                        amount = row.get("总成交额")
                        if amount is None:
                            amount = row.get("总成交额", 0)
                        sector = {
                            "code": str(row.get("板块代码", "")),
                            "name": str(name or ""),
                            "change_pct": self._safe_float(row.get(change_col, 0)),
                            "up_count": int(self._safe_float(row.get("上涨家数", 0))),
                            "down_count": int(self._safe_float(row.get("下跌家数", 0))),
                            "leader": str(leader or ""),
                            "leader_pct": self._safe_float(leader_pct or 0),
                            "amount": self._safe_float(amount or 0),
                        }
                        sectors.append(sector)

                    logger.info(f"[市场数据] 获取到 {len(sectors)} 个热门板块")
                    if sectors:
                        logger.info(f"[市场数据] 领涨板块: {[s['name'] for s in sectors[:3]]}")

        except Exception as e:
            logger.error(f"[市场数据] 获取热门板块失败: {e}")

        self._set_cache(cache_key, sectors)
        return sectors

    def get_concept_sectors(self, limit: int = 10) -> list[dict[str, object]]:
        cache_key = f"concept_sectors_{limit}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        sectors = []

        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return sectors

        try:
            logger.info("[市场数据] 获取概念板块...")

            df = self._call_akshare_with_retry(_base.ak.stock_board_concept_name_em, "概念板块")

            if df is not None and not df.empty:
                change_col = "涨跌幅"
                if change_col in df.columns:
                    df[change_col] = _base.pd.to_numeric(df[change_col], errors="coerce")
                    df = df.dropna(subset=[change_col])
                    df_sorted = df.sort_values(by=change_col, ascending=False)

                    for _, row in df_sorted.head(limit).iterrows():
                        sector = {
                            "code": str(row.get("板块代码", "")),
                            "name": str(row.get("板块名称", "")),
                            "change_pct": self._safe_float(row.get(change_col, 0)),
                            "up_count": int(self._safe_float(row.get("上涨家数", 0))),
                            "down_count": int(self._safe_float(row.get("下跌家数", 0))),
                            "leader": str(row.get("领涨股票", "")),
                            "leader_pct": self._safe_float(row.get("领涨股票-涨跌幅", 0)),
                        }
                        sectors.append(sector)

                    logger.info(f"[市场数据] 获取到 {len(sectors)} 个概念板块")

        except Exception as e:
            logger.error(f"[市场数据] 获取概念板块失败: {e}")

        self._set_cache(cache_key, sectors)
        return sectors
