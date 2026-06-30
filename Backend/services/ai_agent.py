"""AI Agent — conversational assistant with tool-calling access to all services."""

import json
import os
import time
import traceback
from collections.abc import Generator
from typing import Any

from core.logging import get_logger

logger = get_logger(__name__)


class AIAgent:
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

    # ------------------------------------------------------------------
    # Tool definitions (OpenAI function-calling format)
    # ------------------------------------------------------------------

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
                    "description": "获取热门行业板块排行（涨跌幅排名）",
                    "parameters": {
                        "type": "object",
                        "properties": {"limit": {"type": "integer", "description": "返回板块数量，默认10"}},
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

    # ------------------------------------------------------------------
    # Tool handlers — map tool names to service functions
    # ------------------------------------------------------------------

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

    # -------- tool implementations --------

    def _tool_search_funds(self, keyword: str) -> Any:
        from services.data_service_client import get_data_service_client

        payload = get_data_service_client().search_funds(keyword)
        return payload.get("data", payload)

    def _tool_get_fund_detail(self, code: str) -> Any:
        try:
            from services.data_service_client import get_data_service_client

            payload = get_data_service_client().get_fund_detail(code)
            return payload.get("data", payload)
        except Exception:
            from fund_api import FundAPI

            api = FundAPI()
            return api.get_fund_data(code)

    def _tool_get_fund_estimate(self, code: str) -> Any:
        from services.data_service_client import get_data_service_client

        payload = get_data_service_client().get_fund_estimate(code)
        return payload.get("data", payload)

    def _tool_get_fund_nav_history(self, code: str, start_date: str | None = None, end_date: str | None = None) -> Any:
        from services.data_service_client import get_data_service_client

        payload = get_data_service_client().get_fund_nav_history(code, start_date or None, end_date or None)
        return payload.get("data", payload)

    def _tool_get_market_indices(self) -> Any:
        from market_data_service import MarketDataService

        return MarketDataService().get_index_realtime()

    def _tool_get_market_news(self, count: int = 20) -> Any:
        from fund_master_service import get_fund_master_service

        result = get_fund_master_service().get_flash_news(count=count)
        if isinstance(result, dict):
            items = result.get("data", result.get("news", result.get("items", [])))
            if isinstance(items, list):
                return [
                    {"title": n.get("title", n.get("content", "")), "time": n.get("time", "")} for n in items[:count]
                ]
            return []
        return []

    def _tool_get_hot_sectors(self, limit: int = 10) -> Any:
        from market_data_service import MarketDataService

        return MarketDataService().get_hot_sectors()[:limit]

    def _tool_get_north_flow(self) -> Any:
        from market_data_service import MarketDataService

        return MarketDataService().get_north_flow()

    def _tool_get_market_breadth(self) -> Any:
        from market_data_service import MarketDataService

        return MarketDataService().get_market_breadth()

    def _tool_get_main_flow(self) -> Any:
        from market_data_service import MarketDataService

        return MarketDataService().get_main_flow()

    def _tool_get_flash_news(self, count: int = 20) -> Any:
        from services.data_service_client import get_data_service_client

        payload = get_data_service_client().get_flash_news(count=count)
        return payload.get("data", payload)

    def _tool_get_watchlist(self) -> Any:
        from database import SessionLocal
        from models import FundWatchlist

        db = SessionLocal()
        try:
            items = db.query(FundWatchlist).order_by(FundWatchlist.sort_order).all()
            return [{"fund_code": w.fund_code, "fund_name": w.fund_name, "fund_type": w.fund_type} for w in items]
        finally:
            db.close()

    def _tool_screen_4433(self) -> Any:
        from database import SessionLocal
        from models import FundBasicInfo, FundScreeningRank

        db = SessionLocal()
        try:
            rows = (
                db.query(FundBasicInfo, FundScreeningRank)
                .join(FundScreeningRank, FundBasicInfo.fund_code == FundScreeningRank.fund_code)
                .filter(FundScreeningRank.pass_4433 == 1)
                .limit(50)
                .all()
            )
            return [
                {
                    "fund_code": b.fund_code,
                    "fund_name": b.fund_name,
                    "fund_type": b.fund_type,
                    "return_1y": b.return_1y,
                }
                for b, r in rows
            ]
        finally:
            db.close()

    def _tool_run_backtest(
        self,
        fund_code: str,
        start_date: str,
        end_date: str,
        amount: float = 1000,
        investment_type: str = "monthly",
    ) -> Any:
        from database import SessionLocal
        from models import FundTrend
        from services.backtest import _run_backtest

        db = SessionLocal()
        try:
            trend = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
            if not trend or not trend.net_worth_trend_json:
                return {"error": "未找到该基金的净值数据，请先查看基金详情"}
            import json

            nav_data = json.loads(trend.net_worth_trend_json)
            nav_dict = {}
            for item in nav_data:
                date_str = item.get("date")
                nav_val = item.get("net_worth")
                if date_str and nav_val is not None:
                    try:
                        nav_dict[date_str] = float(nav_val)
                    except (ValueError, TypeError):
                        continue
            sorted_dates = sorted(nav_dict.keys())
            filtered_dates = [d for d in sorted_dates if start_date <= d <= end_date]
            if len(filtered_dates) < 2:
                return {"error": "指定日期范围内数据不足"}
            result = _run_backtest(nav_dict, filtered_dates, investment_type, amount, 0, 0.0015)
            return result if isinstance(result, dict) else {"error": "回测执行失败"}
        except Exception as e:
            return {"error": f"回测出错: {str(e)}"}
        finally:
            db.close()

    def _tool_suggest_strategy(self, fund_code: str) -> Any:
        from database import SessionLocal
        from models import FundTrend
        from services.backtest_strategies import suggest_optimal_plan

        db = SessionLocal()
        try:
            trend = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
            if not trend or not trend.net_worth_trend_json:
                return {"error": "未找到该基金的净值数据"}
            import json

            nav_data = json.loads(trend.net_worth_trend_json)
            nav_dict = {
                item["date"]: float(item["net_worth"])
                for item in nav_data
                if item.get("date") and item.get("net_worth")
            }
            sorted_dates = sorted(nav_dict.keys())
            return suggest_optimal_plan(nav_dict, sorted_dates)
        except Exception as e:
            return {"error": f"策略推荐出错: {str(e)}"}
        finally:
            db.close()

    def _tool_get_stock_quote(self, code: str) -> Any:
        from services.data_service_client import get_data_service_client

        payload = get_data_service_client().get_stock_reference(code)
        return payload.get("data", payload)

    def _tool_get_market_anomaly(self) -> Any:
        from services.market_alert import detect_market_anomalies

        result = detect_market_anomalies()
        return result if isinstance(result, dict) else {"anomalies": []}

    def _tool_get_gold_realtime(self) -> Any:
        from fund_master_service import get_fund_master_service

        return get_fund_master_service().get_gold_realtime()

    def _tool_get_fund_holdings(self, code: str) -> Any:
        try:
            from services.data_service_client import get_data_service_client

            payload = get_data_service_client().get_fund_holdings(code)
            return payload.get("data", payload)
        except Exception:
            from fund_api import FundAPI

            data = FundAPI().get_fund_data(code)
            if data:
                return data.get("portfolio", data.get("stock_codes", []))
            return {"error": "无法获取持仓数据"}

    def _tool_get_fund_managers(self, code: str) -> Any:
        try:
            from services.data_service_client import get_data_service_client

            payload = get_data_service_client().get_fund_managers(code)
            return payload.get("data", payload)
        except Exception:
            from fund_api import FundAPI

            data = FundAPI().get_fund_data(code)
            if data:
                return data.get("fund_managers", [])
            return {"error": "无法获取经理信息"}

    def _tool_get_funds_by_industry(self, keyword: str) -> Any:
        from database import SessionLocal
        from models import FundBasicInfo, FundIndustryTag

        db = SessionLocal()
        try:
            tags = db.query(FundIndustryTag).filter(FundIndustryTag.industry_tag.like(f"%{keyword}%")).limit(50).all()
            seen_codes: set[str] = set()

            funds: list[dict] = []
            if tags:
                codes = [t.fund_code for t in tags]
                seen_codes.update(codes)
                basics = {
                    b.fund_code: b for b in db.query(FundBasicInfo).filter(FundBasicInfo.fund_code.in_(codes)).all()
                }
                for tag in tags:
                    basic = basics.get(tag.fund_code)
                    funds.append(
                        {
                            "fund_code": tag.fund_code,
                            "fund_name": basic.fund_name if basic else None,
                            "fund_type": basic.fund_type if basic else None,
                            "industry_tag": tag.industry_tag,
                            "industry_ratio": tag.industry_ratio,
                        }
                    )

            if len(funds) < 10:
                name_query = db.query(FundBasicInfo).filter(FundBasicInfo.fund_name.like(f"%{keyword}%"))
                if seen_codes:
                    name_query = name_query.filter(~FundBasicInfo.fund_code.in_(seen_codes))
                for f in name_query.limit(50).all():
                    seen_codes.add(f.fund_code)
                    funds.append(
                        {
                            "fund_code": f.fund_code,
                            "fund_name": f.fund_name,
                            "fund_type": f.fund_type,
                            "industry_tag": None,
                            "industry_ratio": None,
                        }
                    )

                if not funds:
                    return {
                        "funds": [],
                        "total": 0,
                        "message": f"未找到与'{keyword}'相关的基金（行业标签和基金名称均无匹配）。建议使用其他关键词如'光伏'、'锂电'、'风电'等子领域重试。",
                    }

            return {"funds": funds, "total": len(funds)}
        finally:
            db.close()

    # ------------------------------------------------------------------
    # ReAct loop — the core chat loop
    # ------------------------------------------------------------------

    def chat(self, messages: list[dict[str, Any]]) -> Generator[str, None, None]:
        """Send messages, yield SSE-formatted events for frontend.

        Args:
            messages: OpenAI-format message list (with role, content, etc.)
        Yields:
            SSE event strings:
                event: token\\ndata: {"token":"...","full":"..."}\\n\\n
                event: tool_start\\ndata: {"name":"...","params":{...}}\\n\\n
                event: tool_end\\ndata: {"name":"...","result":...,"duration_ms":...}\\n\\n
                event: error\\ndata: {"message":"..."}\\n\\n
                event: done\\ndata: [DONE]\\n\\n
        """
        from openai import OpenAI

        if not self.is_available():
            yield 'event: error\ndata: {"message":"AI 服务未配置，请检查 LLM_API_KEY 环境变量"}\n\n'
            yield "event: done\ndata: [DONE]\n\n"
            return

        client = OpenAI(api_key=self._api_key, base_url=self._api_base)

        system_prompt = """你是一位资深金融投资分析师助手，名为 GoFundBot 助手。

你有丰富的工具可以使用，包括查询基金数据、市场行情、北向资金、板块轮动等。
请根据用户的需求，主动判断需要调用什么工具来获取数据，然后给出专业、简洁的分析。

**第一步：判断问题类型，选择正确的工具分类**：
- 用户问题中出现"基金"、"建仓"、"定投"、"类基金"、"主题基金"、"行业基金" → 这是基金问题！
  必须使用：get_funds_by_industry / search_funds / get_fund_detail 等基金工具
  **禁止调用**：get_stock_quote（个股行情）
  **关键**：从用户问题中提取行业/主题关键词，传入 get_funds_by_industry 的 keyword 参数。
  例如用户问"新能源板块的基金" → 调用 get_funds_by_industry(keyword="新能源")，不得改用其他行业名。
- 用户问具体股票代码或公司名称（如"腾讯"、"NVDA"、"00700"）→ 使用 get_stock_quote
- 用户问大盘/市场情报/行业板块 → 可使用 get_market_indices / get_hot_sectors / get_market_news
  注意：如果用户同时提到"基金"+行业，优先使用基金工具搜索对应行业，get_hot_sectors 仅作辅助参考。

**规则**：
1. 先判断问题所属分类，再选择对应的工具集，不能混淆基金和个股工具。
2. 如果需要获取数据来回答用户问题，请先调用对应的工具，不要凭记忆回答。
3. 调用工具后，根据返回的真实数据进行分析。
4. 你的分析应包含数据解读和投资建议（如有需要）。
5. 回答用中文，简洁专业。
6. 如果数据获取失败，如实告知用户缺少哪方面的数据，不要用其他行业的数据来顶替。
7. 可以同时调用多个不依赖对方的工具来提升效率。
8. 如果 get_funds_by_industry 和 search_funds 均未返回匹配基金，请明确告知用户未找到相关基金并建议用其他关键词重试，绝对不要用不相关的基金或个股来凑合！
9. 🔴 禁止话题漂移：用户问什么行业你就只能分析什么行业。例如用户问"新能源"，你绝对不能转而分析"半导体"或"科技板块"。即使其他板块表现再好，也只能围绕用户指定的主题来回答。
10. 🟡 如实反馈：工具返回空结果或报错时，在回答中如实说明（如"目前未找到新能源相关的基金标签数据"），方便用户了解系统当前的数据覆盖情况。"""

        openai_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            openai_messages.append({"role": role, "content": content})

        # Inject intent guidance for fund-related queries
        last_user_msg = messages[-1].get("content", "") if messages else ""
        fund_markers = ("基金", "建仓", "定投")
        if any(m in last_user_msg for m in fund_markers):
            openai_messages.insert(
                len(openai_messages) - 1,
                {
                    "role": "system",
                    "content": "重要指令：用户问题涉及基金，请使用基金类工具（search_funds、get_funds_by_industry、get_fund_detail）。禁止调用 get_stock_quote 个股行情工具！从用户问题中提取行业/主题名称作为 get_funds_by_industry 的 keyword 参数。如果找不到对应行业的基金，如实告知用户，不要改用其他行业的数据来回答。",
                },
            )

        iter_count = 0
        while iter_count < self.MAX_TOOL_ITERATIONS:
            iter_count += 1

            try:
                response = client.chat.completions.create(
                    model=self._model,
                    messages=openai_messages,
                    tools=self._get_tools(),
                    tool_choice="auto",
                    temperature=0.3,
                    max_tokens=4096,
                )
            except Exception as e:
                logger.error(f"LLM call failed: {e}")
                yield f"event: error\ndata: {json.dumps({'message': f'LLM 调用失败: {str(e)}'})}\n\n"
                break

            choice = response.choices[0]
            message = choice.message

            if message.tool_calls:
                openai_messages.append(
                    {
                        "role": "assistant",
                        "content": message.content or "",
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                            }
                            for tc in message.tool_calls
                        ],
                    }
                )

                for tc in message.tool_calls:
                    name = tc.function.name
                    try:
                        args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        args = {}

                    yield f"event: tool_start\ndata: {json.dumps({'name': name, 'params': args, 'tool_call_id': tc.id})}\n\n"

                    result, duration_ms = self._execute_tool(name, args)

                    yield f"event: tool_end\ndata: {json.dumps({'name': name, 'tool_call_id': tc.id, 'duration_ms': round(duration_ms, 1)}, ensure_ascii=False)}\n\n"

                    result_str = json.dumps(result, ensure_ascii=False) if not isinstance(result, str) else result
                    openai_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result_str,
                        }
                    )

                    if len(result_str) > 8000:
                        result_str = result_str[:8000] + "... (truncated)"
            else:
                content = message.content or ""
                full_content = ""
                try:
                    stream = client.chat.completions.create(
                        model=self._model,
                        messages=openai_messages,
                        temperature=0.3,
                        max_tokens=4096,
                        stream=True,
                    )
                    for chunk in stream:
                        delta = chunk.choices[0].delta if chunk.choices else None
                        token = delta.content if delta else ""
                        if token:
                            full_content += token
                            yield f"event: token\ndata: {json.dumps({'token': token, 'full': full_content}, ensure_ascii=False)}\n\n"
                except Exception as e:
                    if full_content:
                        yield f"event: token\ndata: {json.dumps({'token': '', 'full': full_content}, ensure_ascii=False)}\n\n"
                    else:
                        yield f"event: error\ndata: {json.dumps({'message': f'流式输出失败: {str(e)}'})}\n\n"
                break

        else:
            yield 'event: error\ndata: {"message":"对话超过最大工具调用次数，请简化问题重试"}\n\n'

        yield "event: done\ndata: [DONE]\n\n"


_agent_instance: AIAgent | None = None


def get_ai_agent() -> AIAgent:
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = AIAgent()
    return _agent_instance
