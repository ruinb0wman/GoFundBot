"""AI Agent — conversational assistant with tool-calling access to all services."""

import json
import os
import time
import traceback
from typing import Any

from core.logging import get_logger

from .chat import ChatMixin
from .skills import SKILL_MAP, SkillRouter
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
        self._model = os.getenv("LLM_MODEL", "opencode/deepseek-v4-pro")
        self._skill_router = SkillRouter(self._api_key, self._api_base, self._model)

    def is_available(self) -> bool:
        return bool(self._api_key)

    def route_skill(self, message: str, preferred: str | None = None) -> tuple[str, str]:
        skill = self._skill_router.route(message, preferred)
        return skill.name, skill.system_prompt

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
                    "description": "获取基金完整详情：基本信息、业绩、持仓、基金经理、风险指标等",
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
                    "description": "获取热门行业板块实时行情（申万/同花顺分类），返回板块涨跌幅、领涨股、成交额等。不含概念板块，概念板块请用 get_concept_sectors。",
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
                    "description": "获取东方财富概念板块实时行情，返回板块涨跌幅、指数点位、主力资金净流入等。",
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
                    "description": (
                        "获取北向资金（沪股通+深股通）流向数据。"
                        "⚠️ 重要：必须检查 data_status 字段："
                        "① data_status='unavailable' → 北向资金数据不可用。禁止编造任何资金数值，直接告知用户'北向资金盘中暂无可用数据，建议关注收盘后数据。'并引用 data_note 原文。"
                        "② data_status='historical' → 数据来自 data_date 的历史记录，回答开头必须注明该日期。"
                        "③ data_status='realtime' → 可以正常分析。"
                    ),
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
                    "description": (
                        "获取主力资金流向（超大单/大单/中单/小单净流入）。"
                        "⚠️ 重要：必须检查 data_status 字段："
                        "① data_status='unavailable' → 禁止编造数据，告知用户数据不可用。"
                        "② data_status='historical' → 数据来自 data_date，回答开头必须注明该日期。"
                        "任何情况下都要引用 data_note 中的提示。"
                    ),
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
                    "description": "按4433法则筛选符合条件的基金",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "run_backtest",
                    "description": "对指定基金运行定投回测模拟，对比不同周期和金额的收益表现",
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
                    "description": "为指定基金推荐最优定投策略（MA均线/价值平均等方案对比）",
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
                    "description": "根据行业/主题关键词查找相关基金，返回基金代码、名称和行业标签信息。仅在用户已明确提及具体行业/主题名称时调用。",
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
            {
                "type": "function",
                "function": {
                    "name": "search_news",
                    "description": (
                        "通过网络搜索新闻、政策、行业动态，用于获取近期政策法规或行业新闻。"
                        "与快讯工具（get_market_news/get_flash_news）不同：快讯只返回今日实时消息，"
                        "search_news 可搜索数天至一个月内的时间范围的网络信息。"
                        "使用场景：用户问'XX有什么政策'、'近期XX行业有什么新闻'、'XX新规'等。"
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "搜索关键词，如'碳中和 政策'"},
                            "max_results": {"type": "integer", "description": "最大结果数，默认5"},
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_industry_performance",
                    "description": "获取各行业板块的多周期业绩汇总——各行业中位收益（3月/6月/1年/3年）、正收益基金占比、基金数量。按收益排名预排序（top_3m / top_1y / weak_3m）。用于识别持续走强或走弱的行业趋势，与当日涨跌幅快照（get_hot_sectors）互补。",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
        ]

    def _get_tools_for_skill(self, skill_name: str) -> list[dict[str, Any]]:
        all_tools = self._get_tools()
        skill = SKILL_MAP.get(skill_name)
        if not skill:
            return all_tools
        return [t for t in all_tools if t["function"]["name"] in skill.tool_names]

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
            "search_news": self._tool_search_news,
            "get_industry_performance": self._tool_get_industry_performance,
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
