import logging

from . import base as _base

logger = logging.getLogger(__name__)


class IndicesMixin:
    def get_index_realtime(self) -> list[dict[str, object]]:
        cache_key = "index_realtime"
        cached = self._get_cache(cache_key)
        if cached:
            logger.debug("[市场数据] 使用缓存的指数行情数据")
            return cached

        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            logger.warning("[市场数据] akshare 不可用，返回空数据")
            return self._get_fallback_indices()

        indices = []

        try:
            logger.info("[市场数据] 获取主要指数实时行情...")

            df = self._call_akshare_with_retry(_base.ak.stock_zh_index_spot_sina, "指数行情")

            if df is not None and not df.empty:
                for code, name in self.MAIN_INDICES.items():
                    row = df[df["代码"] == code]
                    if row.empty:
                        row = df[df["代码"].str.contains(code[-6:])]

                    if not row.empty:
                        row = row.iloc[0]
                        prev_close = self._safe_float(row.get("昨收", 0))
                        high = self._safe_float(row.get("最高", 0))
                        low = self._safe_float(row.get("最低", 0))

                        amplitude = 0
                        if prev_close > 0:
                            amplitude = (high - low) / prev_close * 100

                        index_data = {
                            "code": code[-6:],
                            "name": name,
                            "price": self._safe_float(row.get("最新价", 0)),
                            "change_pct": self._safe_float(row.get("涨跌幅", 0)),
                            "change_amt": self._safe_float(row.get("涨跌额", 0)),
                            "volume": self._safe_float(row.get("成交量", 0)),
                            "amount": self._safe_float(row.get("成交额", 0)),
                            "amplitude": round(amplitude, 2),
                            "high": high,
                            "low": low,
                            "open": self._safe_float(row.get("今开", 0)),
                            "prev_close": prev_close,
                        }
                        indices.append(index_data)

                logger.info(f"[市场数据] 获取到 {len(indices)} 个指数行情")

            if not indices:
                data = self._fetch_em_json(
                    "https://push2.eastmoney.com/api/qt/ulist/get",
                    {
                        "fltt": "2",
                        "invt": "2",
                        "fields": "f2,f3,f4,f12,f13,f14",
                        "secids": "1.000001,0.399001,0.399006",
                    },
                )
                if data and data.get("data") and data["data"].get("diff"):
                    diff = data["data"]["diff"]
                    mapping = {"1.000001": "上证指数", "0.399001": "深证成指", "0.399006": "创业板指"}
                    for item in diff:
                        secid = f"{item.get('f13')}.{item.get('f12')}"
                        name = mapping.get(secid)
                        if not name:
                            continue
                        indices.append(
                            {
                                "code": item.get("f12"),
                                "name": name,
                                "price": float(item.get("f2") or 0),
                                "change_pct": float(item.get("f3") or 0),
                                "change_amt": float(item.get("f4") or 0),
                                "volume": 0.0,
                                "amount": 0.0,
                                "amplitude": 0.0,
                                "high": 0.0,
                                "low": 0.0,
                                "open": 0.0,
                                "prev_close": 0.0,
                            }
                        )

        except Exception as e:
            logger.error(f"[市场数据] 获取指数行情失败: {e}")

        if not indices:
            indices = self._get_fallback_indices()

        self._set_cache(cache_key, indices)
        return indices

    def _get_fallback_indices(self) -> list[dict[str, object]]:
        return [
            {"code": "000001", "name": "上证指数", "price": 0, "change_pct": 0, "amount": 0, "amplitude": 0},
            {"code": "399001", "name": "深证成指", "price": 0, "change_pct": 0, "amount": 0, "amplitude": 0},
            {"code": "399006", "name": "创业板指", "price": 0, "change_pct": 0, "amount": 0, "amplitude": 0},
        ]
