"""AI Agent — conversational assistant with tool-calling access to all services."""

import json
import os
import time
import traceback
from typing import Any

from core.logging import get_logger

from .chat import ChatMixin
from .tool_handlers import ToolHandlersMixin

logger = get_logger(__name__)


class AIAgent(ToolHandlersMixin, ChatMixin):
    """Multi-turn conversational AI that can invoke any backend service as a tool.

    Uses OpenAI-compatible function-calling in a ReAct loop.
    Yields SSE-formatted events for frontend consumption.
    """

    MAX_TOOL_ITERATIONS = 8
    TOOL_TIMEOUT = 30

    def __init__(self):
        self._api_key = os.getenv("LLM_API_KEY", "")
        self._api_base = os.getenv("LLM_API_BASE", "https://api.siliconflow.cn/v1")
        self._model = os.getenv("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct")

    def is_available(self) -> bool:
        return bool(self._api_key)

    def _get_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "search_funds",
                    "description": "根据关键字搜索基金代码和名称",
                    "parameters": {
                        "type": "object",
                        "properties": {"keyword": {"type": "string", "description": "基金名称或代码关键字"}},
                        "required": ["keyword"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_fund_detail",
                    "description": "获取基金完整详情（基本信息、业绩、持仓、基金经理、风险指标等）",
                    "parameters": {
                        "type": "object",
                        "properties": {"code": {"type": "string", "description": "6位基金代码"}},
                        "required": ["code"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_fund_estimate",
                    "description": "获取基金实时估值（盘中估算净值/涨跌幅）",
                    "parameters": {
                        "type": "object",
                        "properties": {"code": {"type": "string", "description": "6位基金代码"}},
                        "required": ["code"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_fund_nav_history",
                    "description": "获取基金历史净值数据",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "code": {"type": "string", "description": "6位基金代码"},
                            "start_date": {"type": "string", "description": "起始日期 YYYY-MM-DD（可选）"},
                            "end_date": {"type": "string", "description": "结束日期 YYYY-MM-DD（可选）"},
                        },
                        "required": ["code"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_market_indices",
                    "description": "获取主要股票市场指数实时行情（上证、深证、创业板等）",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_market_news",
                    "description": "获取市场快讯新闻",
                    "parameters": {
                        "type": "object",
                        "properties": {"count": {"type": "integer", "description": "新闻条数，默认20"}},
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_hot_sectors",
                    "description": "获取热门行业板块排行（申万/同花顺行业分类，如电力设备、半导体、医药生物、银行、汽车等）。注意：不含概念/主题板块（如新能源、AI等），那些需使用 get_concept_sectors。",
                    "parameters": {
                        "type": "object",
                        "properties": {"limit": {"type": "integer", "description": "返回板块数量，默认10"}},
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_concept_sectors",
                    "description": "获取东方财富概念板块排行（涨跌幅排序）。概念板块如：新能源、人工智能、低空经济、碳中和、人形机器人、华为概念等。注意与 get_hot_sectors（行业板块）的区别——行业板块是申万/同花顺分类，概念板块是东方财富主题概念分类。当用户询问概念/主题板块行情时使用此工具。",
                    "parameters": {
                        "type": "object",
                        "properties": {"limit": {"type": "integer", "description": "返回板块数量，默认10，最大50"}},
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_north_flow",
                    "description": "获取北向资金（沪股通+深股通）实时流向数据",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_market_breadth",
                    "description": "获取市场涨跌统计（上涨/下跌/涨停/跌停家数）",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_main_flow",
                    "description": "获取主力资金流向（超大单/大单/中单/小单净流入）",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_flash_news",
                    "description": "获取 DataService 的快讯新闻",
                    "parameters": {
                        "type": "object",
                        "properties": {"count": {"type": "integer", "description": "新闻条数，默认20"}},
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_watchlist",
                    "description": "获取用户的基金自选列表",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "screen_funds_by_4433",
                    "description": "使用4433法则筛选基金",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "run_backtest",
                    "description": "对指定基金运行定投回测模拟",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "fund_code": {"type": "string", "description": "6位基金代码"},
                            "start_date": {"type": "string", "description": "开始日期 YYYY-MM-DD"},
                            "end_date": {"type": "string", "description": "结束日期 YYYY-MM-DD"},
                            "amount": {"type": "number", "description": "每期定投金额，默认1000"},
                            "investment_type": {
                                "type": "string",
                                "description": "定投周期: monthly/weekly, 默认monthly",
                            },
                        },
                        "required": ["fund_code", "start_date", "end_date"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "suggest_strategy",
                    "description": "为指定基金推荐最优定投策略",
                    "parameters": {
                        "type": "object",
                        "properties": {"fund_code": {"type": "string", "description": "6位基金代码"}},
                        "required": ["fund_code"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_stock_quote",
                    "description": "获取个股实时行情（价格、涨跌幅、成交量等）",
                    "parameters": {
                        "type": "object",
                        "properties": {"code": {"type": "string", "description": "6位股票代码"}},
                        "required": ["code"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_market_anomaly",
                    "description": "检查市场异动（指数涨跌幅超过阈值）",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_gold_realtime",
                    "description": "获取实时黄金价格",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_fund_holdings",
                    "description": "获取基金重仓持股列表",
                    "parameters": {
                        "type": "object",
                        "properties": {"code": {"type": "string", "description": "6位基金代码"}},
                        "required": ["code"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_fund_managers",
                    "description": "获取基金经理信息",
                    "parameters": {
                        "type": "object",
                        "properties": {"code": {"type": "string", "description": "6位基金代码"}},
                        "required": ["code"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_funds_by_industry",
                    "description": "根据行业/主题标签查找相关基金。适用于用户询问某类基金（如新能源、医药、半导体、白酒、军工等）。返回基金代码、名称和行业标签信息。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "keyword": {
                                "type": "string",
                                "description": "行业/主题关键词，如'新能源'、'医药'、'半导体'、'白酒'、'军工'等",
                            }
                        },
                        "required": ["keyword"],
                    },
                },
            },
        ]

    def _execute_tool(self, name: str, args: dict[str, Any]) -> tuple[Any, float]:
        """Execute a tool and return (result, duration_ms)."""
        start = time.time()
        try:
            handler = self._get_handler(name)
            result = handler(**args)
            duration = (time.time() - start) * 1000
            return result, duration
        except Exception as e:
            duration = (time.time() - start) * 1000
            logger.error(f"Tool {name} failed: {e}\n{traceback.format_exc()}")
            return {"error": str(e)}, duration

    def _get_handler(self, name: str):
        handlers = {
            "search_funds": self._tool_search_funds,
            "get_fund_detail": self._tool_get_fund_detail,
            "get_fund_estimate": self._tool_get_fund_estimate,
            "get_fund_nav_history": self._tool_get_fund_nav_history,
            "get_market_indices": self._tool_get_market_indices,
            "get_market_news": self._tool_get_market_news,
            "get_hot_sectors": self._tool_get_hot_sectors,
            "get_concept_sectors": self._tool_get_concept_sectors,
            "get_north_flow": self._tool_get_north_flow,
            "get_market_breadth": self._tool_get_market_breadth,
            "get_main_flow": self._tool_get_main_flow,
            "get_flash_news": self._tool_get_flash_news,
            "get_watchlist": self._tool_get_watchlist,
            "screen_funds_by_4433": self._tool_screen_4433,
            "run_backtest": self._tool_run_backtest,
            "suggest_strategy": self._tool_suggest_strategy,
            "get_stock_quote": self._tool_get_stock_quote,
            "get_market_anomaly": self._tool_get_market_anomaly,
            "get_gold_realtime": self._tool_get_gold_realtime,
            "get_fund_holdings": self._tool_get_fund_holdings,
            "get_fund_managers": self._tool_get_fund_managers,
            "get_funds_by_industry": self._tool_get_funds_by_industry,
        }
        handler = handlers.get(name)
        if not handler:
            raise ValueError(f"Unknown tool: {name}")
        return handler

    @staticmethod
    def _expand_industry_keyword(keyword: str) -> list[str]:
        from services.industry_classification import SHENWAN_SECTOR_MAP, TOPIC_RULES

        kw_upper = keyword.upper()
        terms = {keyword}

        for topic, sub_keywords in TOPIC_RULES:
            if any(kw_upper == k.upper() or kw_upper in k.upper() for k in sub_keywords):
                terms.add(topic)
                terms.update(sub_keywords)

        parent = SHENWAN_SECTOR_MAP.get(keyword)
        if parent:
            for child, p in SHENWAN_SECTOR_MAP.items():
                if p == parent:
                    terms.add(child)

        for child_kw in list(terms):
            parent2 = SHENWAN_SECTOR_MAP.get(child_kw)
            if parent2:
                for child2, p2 in SHENWAN_SECTOR_MAP.items():
                    if p2 == parent2:
                        terms.add(child2)

        return list(terms)


_agent_instance: AIAgent | None = None


def get_ai_agent() -> AIAgent:
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = AIAgent()
    return _agent_instance
