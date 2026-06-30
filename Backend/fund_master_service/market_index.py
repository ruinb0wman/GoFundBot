# -*- coding: UTF-8 -*-
"""
Fund-Master 市场指数汇总模块
"""

import datetime

from core.logging import get_logger

logger = get_logger(__name__)


class FundMasterServiceMarketIndexMixin:
    """Mixin: 市场指数汇总"""

    def get_market_index(self) -> dict:
        """
        获取市场指数汇总（A股主要指数 + 全球指数）
        数据源：新浪财经 (Sina Finance)

        Returns:
            dict: {'success': bool, 'data': list, 'update_time': str}
        """
        cache_key = "market_index"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        try:
            result = self._get_market_index_sina()
            if result:
                data = {
                    "success": True,
                    "data": result,
                    "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "source": "sina",
                }
                self._set_cache(cache_key, data, "market_index")
                return data
            return {"success": False, "error": "获取指数数据失败", "data": []}
        except Exception as e:
            stale = self._get_stale_cache(cache_key)
            if stale and stale.get("data"):
                stale = {**stale, "source": "stale_cache"}
                return stale
            return {"success": False, "error": self._short_error(e), "data": []}

    def _get_market_index_sina(self) -> list:
        """新浪指数兜底；如果网络仍不可用，返回结构稳定的占位行情。"""
        code_map = [
            ("sh000001", "上证指数", "A股"),
            ("sz399001", "深证成指", "A股"),
            ("sz399006", "创业板指", "A股"),
            ("sz399005", "中小100", "A股"),
            ("sh000300", "沪深300", "A股"),
            ("sh000016", "上证50", "A股"),
            ("sh000688", "科创50", "A股"),
            ("hkHSI", "恒生指数", "港股"),
            ("hkHSCEI", "国企指数", "港股"),
            ("hkHSTECH", "恒生科技", "港股"),
            ("gb_ixic", "纳斯达克", "美股"),
            ("gb_dji", "道琼斯", "美股"),
            ("gb_inx", "标普500", "美股"),
            ("b_NKY", "日经225", "全球"),
            ("b_KS11", "韩国综合", "全球"),
            ("b_UKX", "英国富时100", "全球"),
            ("b_DAX", "德国DAX", "全球"),
            ("b_CAC", "法国CAC40", "全球"),
            ("b_SENSEX", "印度SENSEX", "全球"),
        ]
        try:
            url = "https://hq.sinajs.cn/list=" + ",".join(code for code, _, _ in code_map)
            headers = {
                "Referer": "https://finance.sina.com.cn/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            }
            response = self.session.get(url, headers=headers, timeout=8, verify=False)
            response.raise_for_status()
            response.encoding = "gbk"
            text = response.text
            result = []
            now = datetime.datetime.now()
            for code, fallback_name, market in code_map:
                marker = f'var hq_str_{code}="'
                start = text.find(marker)
                if start < 0:
                    continue
                start += len(marker)
                end = text.find('";', start)
                payload = text[start:end]
                parts = payload.split(",")
                if len(parts) < 4:
                    continue

                if code.startswith(("sh", "sz")):
                    name = parts[0] or fallback_name
                    price = self._safe_float(parts[3])
                    prev_close = self._safe_float(parts[2])
                    pct = ((price - prev_close) / prev_close * 100) if prev_close else 0.0
                elif code.startswith("hk"):
                    name = fallback_name
                    price = self._safe_float(parts[6] if len(parts) > 6 else parts[3])
                    pct = self._safe_float(parts[8] if len(parts) > 8 else 0)
                else:
                    name = fallback_name
                    if code.startswith("b_"):
                        price = self._safe_float(parts[1] if len(parts) > 1 else 0)
                        pct = self._safe_float(parts[3] if len(parts) > 3 else 0)
                    else:
                        price = self._safe_float(parts[1] if len(parts) > 1 else 0)
                        pct = self._safe_float(parts[2] if len(parts) > 2 else 0)

                    data_date_str = ""
                    if code.startswith("b_") and len(parts) > 6:
                        data_date_str = parts[6].strip()[:10]
                    elif code.startswith("gb_") and len(parts) > 3:
                        data_date_str = parts[3].strip()[:10]

                    if data_date_str:
                        try:
                            data_date = datetime.datetime.strptime(data_date_str, "%Y-%m-%d")
                            calendar_days_old = (now - data_date).days
                            weeks = calendar_days_old // 7
                            trading_days_old = calendar_days_old - (weeks * 2)
                            if trading_days_old > 5:
                                logger.info(
                                    f"[Sina] {fallback_name} 数据日期 {data_date_str} "
                                    f"({calendar_days_old}天前/{trading_days_old}交易日)，数据可能陈旧但仍显示"
                                )
                        except ValueError:
                            pass

                result.append(
                    {
                        "code": code,
                        "name": name,
                        "price": f"{price:.2f}" if price else "-",
                        "change_pct": f"{'+' if pct >= 0 else ''}{pct:.2f}%",
                        "market": market,
                        "raw_change": pct,
                        "prev_close": prev_close,
                    }
                )
            if result:
                return result
        except Exception:
            pass

        return [
            {"name": "上证指数", "price": "-", "change_pct": "0.00%", "market": "A股", "raw_change": 0.0},
            {"name": "深证成指", "price": "-", "change_pct": "0.00%", "market": "A股", "raw_change": 0.0},
            {"name": "创业板指", "price": "-", "change_pct": "0.00%", "market": "A股", "raw_change": 0.0},
            {"name": "中小100", "price": "-", "change_pct": "0.00%", "market": "A股", "raw_change": 0.0},
            {"name": "沪深300", "price": "-", "change_pct": "0.00%", "market": "A股", "raw_change": 0.0},
            {"name": "上证50", "price": "-", "change_pct": "0.00%", "market": "A股", "raw_change": 0.0},
            {"name": "科创50", "price": "-", "change_pct": "0.00%", "market": "A股", "raw_change": 0.0},
            {"name": "恒生指数", "price": "-", "change_pct": "0.00%", "market": "港股", "raw_change": 0.0},
            {"name": "国企指数", "price": "-", "change_pct": "0.00%", "market": "港股", "raw_change": 0.0},
            {"name": "恒生科技", "price": "-", "change_pct": "0.00%", "market": "港股", "raw_change": 0.0},
            {"name": "纳斯达克", "price": "-", "change_pct": "0.00%", "market": "美股", "raw_change": 0.0},
            {"name": "道琼斯", "price": "-", "change_pct": "0.00%", "market": "美股", "raw_change": 0.0},
            {"name": "标普500", "price": "-", "change_pct": "0.00%", "market": "美股", "raw_change": 0.0},
            {"name": "日经225", "price": "-", "change_pct": "0.00%", "market": "全球", "raw_change": 0.0},
            {"name": "韩国综合", "price": "-", "change_pct": "0.00%", "market": "全球", "raw_change": 0.0},
            {"name": "英国富时100", "price": "-", "change_pct": "0.00%", "market": "全球", "raw_change": 0.0},
            {"name": "德国DAX", "price": "-", "change_pct": "0.00%", "market": "全球", "raw_change": 0.0},
            {"name": "法国CAC40", "price": "-", "change_pct": "0.00%", "market": "全球", "raw_change": 0.0},
            {"name": "印度SENSEX", "price": "-", "change_pct": "0.00%", "market": "全球", "raw_change": 0.0},
        ]
