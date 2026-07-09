import logging
from datetime import datetime

from . import base as _base

logger = logging.getLogger(__name__)

try:
    import efinance as ef

    EF_AVAILABLE = True
except Exception:
    EF_AVAILABLE = False


class MarketMixin:
    def get_north_flow(self) -> dict[str, object]:
        cache_key = "north_flow"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        result = self._build_unavailable_result("北向资金")
        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return result

        try:
            logger.info("[市场数据] 获取北向资金数据...")
            result = self._do_get_north_flow(result)
        except Exception as e:
            logger.error(f"[市场数据] 获取北向资金失败: {e}")

        self._set_cache(cache_key, result)
        return result

    def _build_unavailable_result(self, name: str) -> dict[str, object]:
        return {
            "data_status": "unavailable",
            "data_date": None,
            "data_source": None,
            "data_note": f"{name}数据当前不可用。",
            "update_time": datetime.now().strftime("%H:%M:%S"),
        }

    def _do_get_north_flow(self, fallback: dict) -> dict[str, object]:
        df = self._call_akshare_with_retry(_base.ak.stock_hsgt_fund_flow_summary_em, "北向资金实时汇总")
        if df is None or df.empty:
            hist = self._try_north_flow_hist()
            return hist or fallback

        north = df[df["资金方向"] == "北向"]
        if north.empty:
            hist = self._try_north_flow_hist()
            return hist or fallback

        data_date = str(north.iloc[0]["交易日"])
        sh_row = north[north["板块"] == "沪股通"]
        sz_row = north[north["板块"] == "深股通"]

        result: dict[str, object] = {
            "data_date": data_date,
            "data_source": "fund_flow_summary",
            "update_time": datetime.now().strftime("%H:%M:%S"),
        }

        if not sh_row.empty:
            r = sh_row.iloc[0]
            result["sh_up_count"] = int(r.get("上涨数", 0))
            result["sh_down_count"] = int(r.get("下跌数", 0))
            sh_net = self._safe_float(r.get("成交净买额", 0))
        else:
            sh_net = 0

        if not sz_row.empty:
            r = sz_row.iloc[0]
            result["sz_up_count"] = int(r.get("上涨数", 0))
            result["sz_down_count"] = int(r.get("下跌数", 0))
            sz_net = self._safe_float(r.get("成交净买额", 0))
        else:
            sz_net = 0

        if sh_net != 0 or sz_net != 0:
            result["data_status"] = "realtime"
            result["sh"] = round(sh_net, 2)
            result["sz"] = round(sz_net, 2)
            result["total"] = round(sh_net + sz_net, 2)
            result["data_note"] = f"北向资金实时数据（来自东方财富实时汇总，{data_date}）"
            logger.info(f"[市场数据] 北向资金净流入: {result['total']}亿 (沪:{sh_net} 深:{sz_net})")
            return result

        hist = self._try_north_flow_hist()
        if hist is not None:
            hist.update(result)
            return hist

        result["data_status"] = "unavailable"
        result["data_note"] = "北向资金实时流向数据盘中暂不可用（数据源未推送当日北向资金净流向）。"
        return result

    def _try_north_flow_hist(self) -> dict | None:
        found: dict[str, object] = {}
        for symbol, key in [("沪股通", "sh"), ("深股通", "sz")]:
            try:
                df = self._call_akshare_with_retry(
                    lambda s=symbol: _base.ak.stock_hsgt_hist_em(symbol=s), f"{symbol}历史"
                )
                if df is not None and not df.empty:
                    for idx in range(len(df) - 1, -1, -1):
                        row = df.iloc[idx]
                        for col in ["当日资金流入", "资金流入", "当日净流入"]:
                            if col not in df.columns:
                                continue
                            val = self._safe_float(row.get(col), default=None)
                            if val is not None and val != 0:
                                date_val = row.get("日期")
                                if date_val is not None:
                                    found[f"{key}_date"] = str(date_val)
                                found[key] = round(val, 2)
                                break
                        if key in found:
                            break
            except Exception as e:
                logger.warning(f"[市场数据] {symbol}历史数据回退失败: {e}")

        if "sh" not in found and "sz" not in found:
            return None

        sh_val = float(found.get("sh", 0))
        sz_val = float(found.get("sz", 0))
        sh_date = str(found.get("sh_date", ""))
        sz_date = str(found.get("sz_date", ""))
        dates = [d for d in [sh_date, sz_date] if d]
        data_date = max(dates) if dates else "unknown"

        result: dict[str, object] = {
            "data_status": "historical",
            "data_date": data_date,
            "data_source": "hist_em",
            "sh": sh_val,
            "sz": sz_val,
            "total": round(sh_val + sz_val, 2),
            "data_note": f"北向资金数据来自 {data_date}（历史记录），非实时数据。",
        }
        logger.info(f"[市场数据] 北向资金历史回退成功: total={result['total']}亿 日期={data_date}")
        return result

    def _try_ds_main_flow(self) -> dict[str, object] | None:
        try:
            from services.data_service_client import DataServiceError, get_data_service_client

            client = get_data_service_client()
            ds = client.get_market_money_flow()
            if not ds or not isinstance(ds, dict):
                return None
            ds_data = ds.get("data") if isinstance(ds.get("data"), dict) else None
            if not ds_data:
                return None

            ds_date = ds_data.get("date", "")
            if not ds_date:
                return None

            raw_main = self._safe_float(ds_data.get("mainNetInflow"))
            raw_super = self._safe_float(ds_data.get("superLargeNetInflow"))
            raw_large = self._safe_float(ds_data.get("largeNetInflow"))
            raw_medium = self._safe_float(ds_data.get("mediumNetInflow"))
            raw_small = self._safe_float(ds_data.get("smallNetInflow"))

            if raw_main is None:
                return None

            result: dict[str, object] = {
                "data_status": "realtime",
                "data_date": ds_date,
                "data_source": "data_service.eastmoney",
                "super_large": round(raw_super / 1e8, 2),
                "large": round(raw_large / 1e8, 2),
                "medium": round(raw_medium / 1e8, 2),
                "small": round(raw_small / 1e8, 2),
                "main_net": round((raw_super + raw_large) / 1e8, 2),
                "data_note": f"主力资金数据来自 DataService（{ds_date}）。",
                "update_time": datetime.now().strftime("%H:%M:%S"),
            }
            logger.info(f"[市场数据] DataService 主力净流入: {result['main_net']}亿 (日期{ds_date})")
            return result
        except ImportError:
            logger.warning("[市场数据] DataServiceClient 不可用（未安装依赖）")
            return None
        except DataServiceError as e:
            logger.warning(f"[市场数据] DataService 主力资金不可用，回退 akshare: {e}")
            return None
        except Exception as e:
            logger.warning(f"[市场数据] DataService 主力资金异常: {e}")
            return None

    def get_main_flow(self) -> dict[str, object]:
        cache_key = "main_flow"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        # 1) Try DataService first
        ds_result = self._try_ds_main_flow()
        if ds_result:
            self._set_cache(cache_key, ds_result)
            return ds_result

        # 2) Fallback to akshare
        result = self._build_unavailable_result("主力资金")
        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return result

        try:
            logger.info("[市场数据] 获取主力资金数据（akshare 回退）...")
            result = self._do_get_main_flow(result)
        except Exception as e:
            logger.error(f"[市场数据] 获取主力资金失败: {e}")

        self._set_cache(cache_key, result)
        return result

    def _do_get_main_flow(self, fallback: dict) -> dict[str, object]:
        df = self._call_akshare_with_retry(_base.ak.stock_market_fund_flow, "主力资金")
        if df is None or df.empty:
            return fallback

        for idx in range(len(df) - 1, -1, -1):
            row = df.iloc[idx]
            main_net_raw = self._safe_float(row.get("主力净流入-净额", 0), default=None)
            if main_net_raw is None:
                continue

            data_date = str(row.get("日期", ""))
            if not data_date:
                continue

            super_large = self._safe_float(row.get("超大单净流入-净额", 0), default=0)
            large = self._safe_float(row.get("大单净流入-净额", 0), default=0)
            medium = self._safe_float(row.get("中单净流入-净额", 0), default=0)
            small = self._safe_float(row.get("小单净流入-净额", 0), default=0)

            result: dict[str, object] = {
                "data_status": "historical",
                "data_date": data_date,
                "data_source": "market_fund_flow",
                "super_large": round(super_large / 1e8, 2),
                "large": round(large / 1e8, 2),
                "medium": round(medium / 1e8, 2),
                "small": round(small / 1e8, 2),
                "main_net": round((super_large + large) / 1e8, 2),
                "data_note": f"主力资金数据来自 {data_date}（上一个交易日）。",
                "update_time": datetime.now().strftime("%H:%M:%S"),
            }
            logger.info(f"[市场数据] 主力净流入: {result['main_net']}亿 (日期{data_date})")
            return result

        return fallback

    def _try_ds_breadth(self) -> dict[str, object] | None:
        try:
            from services.data_service_client import DataServiceError, get_data_service_client

            client = get_data_service_client()
            ds = client.get_market_breadth()
            if not ds or not isinstance(ds, dict):
                return None
            ds_data = ds.get("data") if isinstance(ds.get("data"), dict) else None
            if not ds_data:
                return None

            result: dict[str, object] = {
                "up_count": int(ds_data.get("upCount", 0)),
                "down_count": int(ds_data.get("downCount", 0)),
                "flat_count": int(ds_data.get("flatCount", 0)),
                "limit_up": int(ds_data.get("limitUp", 0)),
                "limit_down": int(ds_data.get("limitDown", 0)),
                "update_time": datetime.now().strftime("%H:%M:%S"),
                "source": "data_service",
            }
            logger.info(f"[市场数据] DataService 涨跌统计: 涨{result['up_count']} 跌{result['down_count']}")
            return result
        except ImportError:
            return None
        except DataServiceError as e:
            logger.warning(f"[市场数据] DataService 涨跌统计不可用: {e}")
            return None
        except Exception as e:
            logger.warning(f"[市场数据] DataService 涨跌统计异常: {e}")
            return None

    def get_market_breadth(self) -> dict[str, object]:
        cache_key = "market_breadth"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        # 1) Try DataService first
        ds_result = self._try_ds_breadth()
        if ds_result:
            self._set_cache(cache_key, ds_result)
            return ds_result

        # 2) Fallback to akshare
        result = {
            "up_count": 0,
            "down_count": 0,
            "flat_count": 0,
            "limit_up": 0,
            "limit_down": 0,
            "update_time": datetime.now().strftime("%H:%M:%S"),
        }

        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return result

        try:
            logger.info("[市场数据] 获取市场涨跌统计（akshare 回退）...")

            df = self._call_akshare_with_retry(_base.ak.stock_zh_a_spot_em, "A股实时行情")
            if (df is None or df.empty) and _base.AKSHARE_AVAILABLE:
                try:
                    df = self._call_akshare_with_retry(_base.ak.stock_zh_a_spot, "A股实时行情(Sina)")
                except Exception:
                    df = None
            if (df is None or df.empty) and EF_AVAILABLE:
                try:
                    df = ef.stock.get_realtime_quotes()
                except Exception:
                    df = None

            if df is not None and not df.empty:
                change_col = "涨跌幅"
                if change_col in df.columns:
                    df[change_col] = _base.pd.to_numeric(df[change_col], errors="coerce")

                    result["up_count"] = len(df[df[change_col] > 0])
                    result["down_count"] = len(df[df[change_col] < 0])
                    result["flat_count"] = len(df[df[change_col] == 0])

                    result["limit_up"] = len(df[df[change_col] >= 9.9])
                    result["limit_down"] = len(df[df[change_col] <= -9.9])

                logger.info(
                    f"[市场数据] 涨:{result['up_count']} 跌:{result['down_count']} "
                    f"涨停:{result['limit_up']} 跌停:{result['limit_down']}"
                )

        except Exception as e:
            logger.error(f"[市场数据] 获取市场广度失败: {e}")

        self._set_cache(cache_key, result)
        return result

    def get_limit_up_stocks(self, limit: int = 10) -> list[dict[str, object]]:
        cache_key = f"limit_up_stocks_{limit}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        stocks = []

        _base._ensure_akshare()
        if not _base.AKSHARE_AVAILABLE:
            return stocks

        try:
            logger.info("[市场数据] 获取涨停股票...")

            today = datetime.now().strftime("%Y%m%d")
            df = self._call_akshare_with_retry(lambda: _base.ak.stock_zt_pool_em(date=today), "涨停股池")

            if df is not None and not df.empty:
                for _, row in df.head(limit).iterrows():
                    stock = {
                        "code": str(row.get("代码", "")),
                        "name": str(row.get("名称", "")),
                        "price": self._safe_float(row.get("最新价", 0)),
                        "change_pct": self._safe_float(row.get("涨跌幅", 0)),
                        "amount": round(self._safe_float(row.get("成交额", 0)) / 1e8, 2),
                        "reason": str(row.get("涨停原因", "")),
                        "first_time": str(row.get("首次封板时间", "")),
                        "last_time": str(row.get("最后封板时间", "")),
                        "open_count": int(self._safe_float(row.get("炸板次数", 0))),
                        "continuous_days": int(self._safe_float(row.get("连板数", 1))),
                    }
                    stocks.append(stock)

                logger.info(f"[市场数据] 获取到 {len(stocks)} 只涨停股票")

        except Exception as e:
            logger.error(f"[市场数据] 获取涨停股票失败: {e}")

        self._set_cache(cache_key, stocks)
        return stocks
