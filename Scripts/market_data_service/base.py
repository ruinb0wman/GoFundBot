"""
实时市场数据服务 (增强版)
使用 akshare 库获取 A 股市场的实时行情数据，包括：
- 核心指数（上证、深证、创业板等）
- 成交额、振幅
- 北向资金流向
- 主力资金流向
- 涨跌停统计
- 热门板块排行

参考 daily_stock_analysis 项目的数据获取模式
"""

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

AKSHARE_AVAILABLE = False
pd = None
ak = None


def _ensure_akshare():
    global AKSHARE_AVAILABLE, ak, pd
    import os as _os

    if _os.environ.get("DISABLE_AKSHARE_FALLBACK") == "1":
        return False
    if AKSHARE_AVAILABLE:
        return True
    try:
        import akshare as _ak
        import pandas as _pd

        globals()["ak"] = _ak
        globals()["pd"] = _pd
        AKSHARE_AVAILABLE = True
        return True
    except ImportError:
        logger.warning("akshare 未安装，部分功能将不可用。请运行: pip install akshare")
        return False


@dataclass
class MarketIndex:
    code: str
    name: str
    price: float = 0.0
    change_pct: float = 0.0
    change_amt: float = 0.0
    volume: float = 0.0
    amount: float = 0.0
    amplitude: float = 0.0
    high: float = 0.0
    low: float = 0.0
    open: float = 0.0
    prev_close: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "name": self.name,
            "price": self.price,
            "change_pct": self.change_pct,
            "change_amt": self.change_amt,
            "volume": self.volume,
            "amount": self.amount,
            "amplitude": self.amplitude,
            "high": self.high,
            "low": self.low,
            "open": self.open,
            "prev_close": self.prev_close,
        }


@dataclass
class MarketOverview:
    date: str
    indices: list[dict] = field(default_factory=list)
    up_count: int = 0
    down_count: int = 0
    flat_count: int = 0
    limit_up_count: int = 0
    limit_down_count: int = 0
    total_amount: float = 0.0
    north_flow: dict = field(default_factory=dict)
    main_flow: dict = field(default_factory=dict)
    top_sectors: list[dict] = field(default_factory=list)
    bottom_sectors: list[dict] = field(default_factory=list)


class MarketDataServiceBase:
    _instance = None

    MAIN_INDICES = {
        "sh000001": "上证指数",
        "sz399001": "深证成指",
        "sz399006": "创业板指",
        "sh000688": "科创50",
        "sh000300": "沪深300",
    }

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._cache = {}
        self._cache_time = {}
        self._cache_ttl = 60
        self._initialized = True
        self._last_request_time = None
        self._min_interval = 1.0

    def _enforce_rate_limit(self):
        if self._last_request_time is not None:
            elapsed = time.time() - self._last_request_time
            if elapsed < self._min_interval:
                time.sleep(self._min_interval - elapsed)
        self._last_request_time = time.time()

    def _is_cache_valid(self, key: str) -> bool:
        if key not in self._cache_time:
            return False
        return (time.time() - self._cache_time[key]) < self._cache_ttl

    def _set_cache(self, key: str, data: Any):
        self._cache[key] = data
        self._cache_time[key] = time.time()

    def _get_cache(self, key: str) -> Any | None:
        if self._is_cache_valid(key):
            return self._cache.get(key)
        return None

    def _call_akshare_with_retry(self, fn, name: str, attempts: int = 2):
        last_error = None
        for attempt in range(1, attempts + 1):
            try:
                self._enforce_rate_limit()
                return fn()
            except Exception as e:
                last_error = e
                logger.warning(f"[市场数据] {name} 获取失败 (attempt {attempt}/{attempts}): {e}")
                if attempt < attempts:
                    time.sleep(min(2**attempt, 5))
        logger.error(f"[市场数据] {name} 最终失败: {last_error}")
        return None

    def _fetch_em_json(self, url: str, params: dict | None = None) -> dict[str, Any] | None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://quote.eastmoney.com/",
        }
        errors = []

        s1 = requests.Session()
        s1.trust_env = True
        try:
            resp = s1.get(url, params=params or {}, headers=headers, timeout=8, verify=False)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            errors.append(str(e)[:80])

        s2 = requests.Session()
        s2.trust_env = False
        try:
            resp = s2.get(url, params=params or {}, headers=headers, timeout=8, verify=False)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            errors.append(str(e)[:80])

        if errors:
            logger.warning(f"[市场数据] EM {url} 请求失败: {'; '.join(errors)}")
        return None

    def _safe_float(self, val, default=0.0):
        try:
            if val is None or (pd is not None and isinstance(val, float) and pd.isna(val)):
                return default
            return float(val)
        except (ValueError, TypeError):
            return default

    def get_market_overview(self) -> dict[str, Any]:
        logger.info("========== 开始获取市场概览数据 ==========")

        indices = self.get_index_realtime()
        north_flow = self.get_north_flow()
        main_flow = self.get_main_flow()
        breadth = self.get_market_breadth()
        hot_sectors = self.get_hot_sectors()
        limit_up_stocks = self.get_limit_up_stocks(5)

        total_amount = sum(idx.get("amount", 0) for idx in indices[:2]) / 1e8 if indices else 0

        result = {
            "indices": indices,
            "north_flow": north_flow,
            "main_flow": main_flow,
            "breadth": breadth,
            "hot_sectors": hot_sectors,
            "limit_up_stocks": limit_up_stocks,
            "total_amount": round(total_amount, 2),
            "update_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        logger.info("========== 市场概览数据获取完成 ==========")
        return result

    def generate_ai_strategy(self, market_data: dict[str, Any]) -> dict[str, Any]:
        indices = market_data.get("indices", [])
        north_flow = market_data.get("north_flow", {})
        main_flow = market_data.get("main_flow", {})
        breadth = market_data.get("breadth", {})

        score = 50
        signals = []

        sh_index = next((i for i in indices if "上证" in i.get("name", "")), None)
        if sh_index:
            change = sh_index.get("change_pct", 0)
            if change > 1:
                score += 10
                signals.append("大盘上涨")
            elif change > 0:
                score += 5
                signals.append("大盘微涨")
            elif change < -1:
                score -= 10
                signals.append("大盘下跌")
            elif change < 0:
                score -= 5
                signals.append("大盘微跌")

        total_amount = market_data.get("total_amount", 0)
        if total_amount > 10000:
            score += 10
            signals.append("成交放量")
        elif total_amount > 8000:
            score += 5
            signals.append("成交活跃")
        elif total_amount < 6000:
            score -= 5
            signals.append("成交萎缩")

        north_total = north_flow.get("total", 0)
        if north_total > 50:
            score += 15
            signals.append("北向大幅流入")
        elif north_total > 20:
            score += 10
            signals.append("北向流入")
        elif north_total < -50:
            score -= 15
            signals.append("北向大幅流出")
        elif north_total < -20:
            score -= 10
            signals.append("北向流出")

        main_net = main_flow.get("main_net", 0)
        if main_net > 100:
            score += 10
            signals.append("主力大幅流入")
        elif main_net > 0:
            score += 5
            signals.append("主力流入")
        elif main_net < -100:
            score -= 10
            signals.append("主力大幅流出")
        elif main_net < 0:
            score -= 5
            signals.append("主力流出")

        up_count = breadth.get("up_count", 0)
        down_count = breadth.get("down_count", 0)
        if up_count > 0 and down_count > 0:
            ratio = up_count / (up_count + down_count)
            if ratio > 0.7:
                score += 15
                signals.append("普涨行情")
            elif ratio > 0.5:
                score += 5
                signals.append("多数上涨")
            elif ratio < 0.3:
                score -= 15
                signals.append("普跌行情")
            elif ratio < 0.5:
                score -= 5
                signals.append("多数下跌")

        limit_up = breadth.get("limit_up", 0)
        limit_down = breadth.get("limit_down", 0)
        if limit_up > 100:
            score += 10
            signals.append(f"涨停{limit_up}家")
        elif limit_up > 50:
            score += 5
            signals.append(f"涨停{limit_up}家")
        if limit_down > 50:
            score -= 10
            signals.append(f"跌停{limit_down}家")
        elif limit_down > 20:
            score -= 5
            signals.append(f"跌停{limit_down}家")

        score = max(0, min(100, score))

        sentiment_desc = ""
        suggestion_detail = ""

        if score >= 70:
            sentiment = "乐观"
            sentiment_desc = "市场多头氛围浓厚，资金进场意愿强烈。"
            suggestion = "市场情绪积极，可适当增加仓位，关注热门板块龙头"
            suggestion_detail = "建议重点关注资金持续流入的强势板块，利用回调机会积极布局。当前市场风险偏好提升，可适当提高仓位，但需警惕短期乖离率过大的获利回吐风险。"
            risk_level = "低"
        elif score >= 55:
            sentiment = "偏多"
            sentiment_desc = "市场整体震荡上行，结构性机会为主。"
            suggestion = "市场整体偏强，可维持仓位，精选个股"
            suggestion_detail = "指数表现稳健，但板块轮动较快。建议\u201c轻指数、重个股\u201d，关注业绩确定性强的优质标的，避免盲目追高。资金流向分化，需甄别真假突破。"
            risk_level = "中低"
        elif score >= 45:
            sentiment = "中性"
            sentiment_desc = "多空双方势均力敌，市场进入观望期。"
            suggestion = "市场震荡整理，建议控制仓位，等待方向明确"
            suggestion_detail = "当前市场缺乏明确主线，成交量未能有效放大，上方压力显现。建议多看少动，控制仓位在半仓以下，耐心等待市场方向选择。可关注防御性板块进行避险。"
            risk_level = "中"
        elif score >= 30:
            sentiment = "偏空"
            sentiment_desc = "空头力量占据上风，市场情绪低迷。"
            suggestion = "市场偏弱，建议降低仓位，注意风险控制"
            suggestion_detail = "指数承压下行，资金流出迹象明显。建议严格执行止损纪律，降低仓位，避免接飞刀。耐心等待底部形态确立后再考虑进场。"
            risk_level = "中高"
        else:
            sentiment = "悲观"
            sentiment_desc = "市场恐慌情绪蔓延，下跌趋势明显。"
            suggestion = "市场风险较大，建议轻仓或观望，严格止损"
            suggestion_detail = (
                "系统性风险释放中，切勿盲目抄底。建议保持极低仓位或空仓观望，现金为王，等待市场企稳信号出现。"
            )
            risk_level = "高"

        if "成交放量" in signals:
            suggestion_detail += " 今日成交量有效放大，显示有增量资金入场，有利于行情延续。"
        elif "成交萎缩" in signals:
            suggestion_detail += " 缩量整理意味着变盘节点临近，需密切关注量能变化。"

        if "北向大幅流入" in signals:
            suggestion_detail += " 北向资金大幅净买入，外资对A股配置信心增强，核心资产有望受益。"
        elif "北向大幅流出" in signals:
            suggestion_detail += " 北向资金大幅流出，需警惕权重股抛压。"

        return {
            "score": score,
            "sentiment": sentiment,
            "signals": signals,
            "suggestion": suggestion,
            "suggestion_detail": f"{sentiment_desc} {suggestion_detail}",
            "risk_level": risk_level,
            "update_time": datetime.now().strftime("%H:%M:%S"),
        }
