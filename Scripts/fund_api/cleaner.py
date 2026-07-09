import re
from datetime import datetime
from typing import Any

from core.logging import get_logger
from stock_service import StockService

logger = get_logger(__name__)


class FundDataCleaner:
    def __init__(self):
        self.cleaned_data = {}
        self.stock_service = StockService()

    def normalize_fund_code(self, value: Any) -> str:
        if value is None:
            return ""
        code = str(value).strip().strip('"').strip("'")
        if re.match(r"^\d{1,6}$", code):
            return code.zfill(6)
        return code

    def clean_js_variable(self, value: str) -> Any:
        if value is None:
            return None

        value_str = str(value).strip()

        if value_str.lower() in ["true", "false"]:
            return value_str.lower() == "true"

        if re.match(r"^-?\d+\.?\d*$", value_str):
            try:
                return float(value_str) if "." in value_str else int(value_str)
            except (ValueError, TypeError):
                return value_str

        if (value_str.startswith('"') and value_str.endswith('"')) or (
            value_str.startswith("'") and value_str.endswith("'")
        ):
            return value_str[1:-1]

        return value_str

    def parse_timestamp(self, timestamp: int) -> str:
        try:
            return datetime.utcfromtimestamp(timestamp / 1000 + 8 * 60 * 60).strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            return str(timestamp)

    def clean_rate(self, value: Any) -> Any:
        if value is None:
            return None
        value_str = str(value).strip()
        if not value_str or value_str in ["--", "-", "null", "undefined"]:
            return None
        value_str = value_str.replace("%", "").strip()
        try:
            return float(value_str)
        except (ValueError, TypeError):
            return None

    def clean_array_data(self, data: Any, data_type: str = "general") -> Any:
        if not data:
            return []

        if data_type == "net_worth":
            cleaned = []
            for item in data:
                if isinstance(item, dict):
                    cleaned.append(
                        {
                            "date": self.parse_timestamp(item.get("x")),
                            "net_worth": item.get("y"),
                            "equity_return": item.get("equityReturn"),
                            "dividend": item.get("unitMoney"),
                        }
                    )

            if len(cleaned) >= 2:
                try:
                    v0 = float(cleaned[0]["net_worth"])
                    v1 = float(cleaned[1]["net_worth"])
                    if v0 > 0 and abs((v1 - v0) / v0) > 0.5:
                        cleaned.pop(0)
                except (ValueError, TypeError):
                    pass

            return cleaned

        elif data_type == "position":
            cleaned = []
            for item in data:
                if isinstance(item, list) and len(item) >= 2:
                    cleaned.append({"date": self.parse_timestamp(item[0]), "position_percentage": item[1]})
            return cleaned

        elif data_type == "performance":
            cleaned = []
            for item in data:
                if isinstance(item, dict):
                    series_data = []
                    for data_point in item.get("data", []):
                        if isinstance(data_point, list) and len(data_point) >= 2:
                            series_data.append({"date": self.parse_timestamp(data_point[0]), "value": data_point[1]})

                    cleaned.append({"name": item.get("name"), "data": series_data})
            return cleaned

        elif data_type == "ranking":
            cleaned = []
            for item in data:
                if isinstance(item, dict):
                    cleaned.append(
                        {
                            "date": self.parse_timestamp(item.get("x")),
                            "rank": item.get("y"),
                            "total_funds": item.get("sc"),
                        }
                    )
            return cleaned

        else:
            return [self.clean_js_variable(item) for item in data]

    def clean_fund_info(self, raw_data: dict[str, Any]) -> dict[str, Any]:
        fund_code = self.normalize_fund_code(raw_data.get("fS_code"))

        fund_type = raw_data.get("fund_type_from_cache")
        if not fund_type:
            fund_type = "\u6df7\u5408\u578b"

        info = {
            "fund_name": self.clean_js_variable(raw_data.get("fS_name")),
            "fund_code": fund_code,
            "fund_type": fund_type,
            "original_rate": self.clean_rate(raw_data.get("fund_sourceRate")),
            "current_rate": self.clean_rate(raw_data.get("fund_Rate")),
            "min_subscription_amount": self.clean_js_variable(raw_data.get("fund_minsg")),
            "is_hb": self.clean_js_variable(raw_data.get("ishb")),
        }
        return info

    def clean_performance_data(self, raw_data: dict[str, Any]) -> dict[str, Any]:
        performance = {
            "1_year_return": self.clean_js_variable(raw_data.get("syl_1n")),
            "6_month_return": self.clean_js_variable(raw_data.get("syl_6y")),
            "3_month_return": self.clean_js_variable(raw_data.get("syl_3y")),
            "1_month_return": self.clean_js_variable(raw_data.get("syl_1y")),
        }
        return performance

    @staticmethod
    def _normalize_market(market: str, code: str = "") -> str:
        if not market or str(market).strip() in ("", "--", "None", "null"):
            market = ""
        else:
            market = str(market).strip()

        if market in (
            "\u4e0a\u4ea4\u6240",
            "\u6df1\u4ea4\u6240",
            "\u5317\u4ea4\u6240",
            "\u6e2f\u4ea4\u6240",
            "\u7f8e\u80a1",
        ):
            return market

        market_lower = market.lower()
        mapping = {
            "sh": "\u4e0a\u4ea4\u6240",
            "shanghai": "\u4e0a\u4ea4\u6240",
            "sz": "\u6df1\u4ea4\u6240",
            "shenzhen": "\u6df1\u4ea4\u6240",
            "bj": "\u5317\u4ea4\u6240",
            "beijing": "\u5317\u4ea4\u6240",
            "hk": "\u6e2f\u4ea4\u6240",
            "hongkong": "\u6e2f\u4ea4\u6240",
            "hong kong": "\u6e2f\u4ea4\u6240",
            "us": "\u7f8e\u80a1",
            "nasdaq": "\u7f8e\u80a1",
            "nyse": "\u7f8e\u80a1",
            "amex": "\u7f8e\u80a1",
        }
        if market_lower in mapping:
            return mapping[market_lower]

        for keyword, label in [
            ("\u4e0a\u6d77", "\u4e0a\u4ea4\u6240"),
            ("\u6df1\u5733", "\u6df1\u4ea4\u6240"),
            ("\u5317\u4eac", "\u5317\u4ea4\u6240"),
            ("\u9999\u6e2f", "\u6e2f\u4ea4\u6240"),
        ]:
            if keyword in market:
                return label

        if not market and code:
            code_str = str(code).strip()
            if not code_str.isdigit():
                return "\u7f8e\u80a1"

        return market if market else "--"

    def clean_portfolio_data(self, raw_data: dict[str, Any]) -> dict[str, Any]:
        stock_codes_raw = self.clean_array_data(raw_data.get("stockCodes"))

        code_pairs = []
        seen = set()
        for code in stock_codes_raw:
            normalized = self.stock_service.normalize_code(code)
            if normalized and normalized not in seen:
                seen.add(normalized)
                code_pairs.append((normalized, code))
            elif not normalized:
                code_pairs.append(("", code))

        unique_codes = [p[0] for p in code_pairs if p[0]]

        ds_lookup = {}
        if unique_codes:
            try:
                from services.data_service_client import get_data_service_client

                result = get_data_service_client().get_stock_references(unique_codes)
                items = result.get("data", {}).get("items", []) if isinstance(result, dict) else []
                for item in items or []:
                    if isinstance(item, dict) and item.get("success"):
                        data = item.get("data", {})
                        if data and isinstance(data, dict):
                            ds_lookup[item["code"]] = data
            except Exception as e:
                logger.error(f"clean_portfolio_data: batch DataService call failed: {e}")

        enriched_stocks = []
        if stock_codes_raw:
            for code in stock_codes_raw:
                try:
                    normalized = self.stock_service.normalize_code(code)
                    display_code = normalized or str(code)

                    ds_data = ds_lookup.get(normalized)
                    if ds_data:
                        name = ds_data.get("name") or display_code
                        market = ds_data.get("market") or "--"
                    else:
                        info = self.stock_service.get_stock_info(code)
                        name = info.get("name", display_code) if info else display_code
                        market = info.get("market", "--") if info else "--"

                    enriched_stocks.append(
                        {
                            "code": display_code,
                            "original_code": code,
                            "name": str(name),
                            "market": self._normalize_market(str(market), display_code),
                            "ratio": 0,
                        }
                    )
                except Exception as e:
                    logger.error(f"Error processing stock code {code}: {e}")
                    enriched_stocks.append({"code": str(code), "name": "Unknown", "market": "--", "ratio": 0})

        portfolio = {
            "stock_codes": enriched_stocks,
            "bond_codes": self.clean_array_data(raw_data.get("zqCodes")),
            "stock_codes_new": enriched_stocks,
            "bond_codes_new": self.clean_array_data(raw_data.get("zqCodesNew")),
        }
        return portfolio

    def clean_asset_allocation(self, raw_data: dict[str, Any]) -> dict[str, Any]:
        asset_data = raw_data.get("Data_assetAllocation", {})
        cleaned = {"categories": asset_data.get("categories", []), "series": []}

        for series in asset_data.get("series", []):
            cleaned_series = {
                "name": series.get("name"),
                "type": series.get("type"),
                "data": series.get("data", []),
                "yAxis": series.get("yAxis"),
            }
            cleaned["series"].append(cleaned_series)

        return cleaned

    def clean_fund_manager(self, raw_data: dict[str, Any]) -> list[dict[str, Any]]:
        managers_data = raw_data.get("Data_currentFundManager", [])
        cleaned_managers = []

        for manager in managers_data:
            cleaned_manager = {
                "id": manager.get("id"),
                "name": manager.get("name"),
                "photo_url": manager.get("pic"),
                "star_rating": manager.get("star"),
                "work_experience": manager.get("workTime"),
                "managed_fund_size": manager.get("fundSize"),
                "ability_assessment": {
                    "average_score": manager.get("power", {}).get("avr"),
                    "categories": manager.get("power", {}).get("categories", []),
                    "scores": manager.get("power", {}).get("data", []),
                    "assessment_date": manager.get("power", {}).get("jzrq"),
                },
                "performance": {
                    "categories": manager.get("profit", {}).get("categories", []),
                    "series": manager.get("profit", {}).get("series", []),
                    "assessment_date": manager.get("profit", {}).get("jzrq"),
                },
            }
            cleaned_managers.append(cleaned_manager)

        return cleaned_managers

    def clean_holder_structure(self, raw_data: dict[str, Any]) -> dict[str, Any]:
        holder_data = raw_data.get("Data_holderStructure", {})
        cleaned = {"categories": holder_data.get("categories", []), "series": []}

        for series in holder_data.get("series", []):
            cleaned_series = {"name": series.get("name"), "data": series.get("data", [])}
            cleaned["series"].append(cleaned_series)

        return cleaned

    def clean_same_type_funds(self, raw_data: dict[str, Any]) -> list[list[dict[str, Any]]]:
        same_type_data = raw_data.get("swithSameType", [])
        cleaned_categories = []

        for category in same_type_data:
            cleaned_funds = []
            for fund_str in category:
                parts = fund_str.split("_")
                if len(parts) >= 3:
                    fund_info = {"code": parts[0], "name": parts[1], "return_rate": self.clean_js_variable(parts[2])}
                    cleaned_funds.append(fund_info)
            cleaned_categories.append(cleaned_funds)

        return cleaned_categories

    def clean_all_data(self, raw_data: dict[str, Any]) -> dict[str, Any]:
        if raw_data.get("fundcode") is not None:
            raw_data["fundcode"] = self.normalize_fund_code(raw_data.get("fundcode"))
        if raw_data.get("fS_code") is not None:
            raw_data["fS_code"] = self.normalize_fund_code(raw_data.get("fS_code"))

        net_worth_trend = self.clean_array_data(raw_data.get("Data_netWorthTrend"), "net_worth")

        trend_latest_nav = None
        trend_latest_date = None
        if net_worth_trend:
            last_point = net_worth_trend[-1]
            trend_latest_nav = last_point.get("net_worth") if isinstance(last_point, dict) else None
            trend_latest_date = last_point.get("date") if isinstance(last_point, dict) else None

        fundgz_nav = raw_data.get("dwjz")
        fundgz_date = raw_data.get("jzrq")

        net_worth = fundgz_nav
        net_worth_date = fundgz_date
        if trend_latest_nav is not None and trend_latest_date is not None:
            norm_trend_date = self._normalize_date_for_compare(trend_latest_date)
            norm_fundgz_date = self._normalize_date_for_compare(fundgz_date)
            if not norm_fundgz_date or norm_trend_date >= norm_fundgz_date:
                net_worth = trend_latest_nav
                net_worth_date = trend_latest_date

        cleaned_data = {
            "basic_info": self.clean_fund_info(raw_data),
            "performance": self.clean_performance_data(raw_data),
            "portfolio": self.clean_portfolio_data(raw_data),
            "realtime_estimate": {
                "name": raw_data.get("name"),
                "fund_code": raw_data.get("fundcode"),
                "net_worth": net_worth,
                "net_worth_date": net_worth_date,
                "estimate_value": raw_data.get("gsz"),
                "estimate_change": raw_data.get("gszzl"),
                "estimate_time": raw_data.get("gztime"),
            },
            "net_worth_trend": net_worth_trend,
            "accumulated_net_worth": self.clean_array_data(raw_data.get("Data_ACWorthTrend"), "position"),
            "position_trend": self.clean_array_data(raw_data.get("Data_fundSharesPositions"), "position"),
            "total_return_trend": self.clean_array_data(raw_data.get("Data_grandTotal"), "performance"),
            "ranking_trend": self.clean_array_data(raw_data.get("Data_rateInSimilarType"), "ranking"),
            "ranking_percentage": self.clean_array_data(raw_data.get("Data_rateInSimilarPersent"), "position"),
            "scale_fluctuation": raw_data.get("Data_fluctuationScale", {}),
            "holder_structure": self.clean_holder_structure(raw_data),
            "asset_allocation": self.clean_asset_allocation(raw_data),
            "performance_evaluation": raw_data.get("Data_performanceEvaluation", {}),
            "fund_managers": self.clean_fund_manager(raw_data),
            "subscription_redemption": raw_data.get("Data_buySedemption", {}),
            "same_type_funds": self.clean_same_type_funds(raw_data),
            "cleaning_timestamp": datetime.now().isoformat(),
        }

        return cleaned_data

    @staticmethod
    def _normalize_date_for_compare(value: Any) -> str:
        if not value:
            return ""
        matched = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", str(value))
        if not matched:
            return str(value)
        return f"{matched.group(1)}-{int(matched.group(2)):02d}-{int(matched.group(3)):02d}"
