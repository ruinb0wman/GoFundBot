"""Tool handler methods for AIAgent — mixed in via inheritance."""

import json
from typing import Any

from core.logging import get_logger

logger = get_logger(__name__)


class ToolHandlersMixin:
    """Mixin providing individual tool handler implementations.

    Mixed into AIAgent so each method has access to self._api_key etc.
    """

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

    def _tool_get_concept_sectors(self, limit: int = 10) -> Any:
        from services.data_service_client import get_data_service_client

        payload = get_data_service_client().get_market_sectors()
        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        items = data.get("items", []) if isinstance(data, dict) else []
        items = sorted(items, key=lambda x: float(x.get("changePercent") or 0), reverse=True)[:limit]

        return [
            {
                "name": item.get("name", ""),
                "code": item.get("code", ""),
                "change_pct": item.get("changePercent"),
                "price": item.get("price"),
                "main_inflow": item.get("mainNetInflow"),
            }
            for item in items
        ]

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
        from sqlalchemy import or_

        from database import SessionLocal
        from models import FundBasicInfo, FundIndustryTag

        db = SessionLocal()
        try:
            search_terms = self._expand_industry_keyword(keyword)
            conditions = [FundIndustryTag.industry_tag.like(f"%{t}%") for t in search_terms]
            tags = db.query(FundIndustryTag).filter(or_(*conditions)).limit(50).all()
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
                        "message": f"未找到与'{keyword}'相关的基金（已自动展开相关关键词搜索，行业标签和基金名称均无匹配）。",
                    }

            return {"funds": funds, "total": len(funds)}
        finally:
            db.close()
