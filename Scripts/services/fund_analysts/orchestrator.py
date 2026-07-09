import concurrent.futures
from typing import Any

from core.logging import get_logger

from .holding_analyst import HoldingAnalyst
from .manager_analyst import ManagerAnalyst
from .market_context_analyst import MarketContextAnalyst
from .performance_analyst import PerformanceAnalyst
from .supervisor import Supervisor

logger = get_logger(__name__)

ROLES = ["performance", "holding", "manager", "market"]


class AnalystOrchestrator:
    def __init__(self, api_key: str, api_base: str, model: str):
        self._api_key = api_key
        self._api_base = api_base
        self._model = model
        self._llm_kwargs = {"api_key": api_key, "api_base": api_base, "model": model}

    def analyze(
        self,
        fund_data: dict[str, Any],
        market_context: str = "",
        past_context: str = "",
    ) -> dict[str, Any]:
        reports: dict[str, dict[str, Any]] = {}
        errors: list[str] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            future_map = {
                executor.submit(self._run_analyst, role, fund_data, market_context, past_context): role
                for role in ROLES
            }
            for future in concurrent.futures.as_completed(future_map):
                role = future_map[future]
                try:
                    report = future.result()
                    reports[role] = report
                except Exception as e:
                    logger.error(f"分析师 {role} 执行失败: {e}")
                    reports[role] = self._default_report(role)
                    errors.append(f"{role}: {e}")

        logger.info(f"四位分析师完成: {len(reports)} 份报告, {len(errors)} 个错误")

        result = Supervisor(**self._llm_kwargs).synthesize(reports, fund_data, market_context, past_context)
        result["analyst_reports"] = [reports.get(r, self._default_report(r)) for r in ROLES]
        return result

    def analyze_sequential(
        self,
        fund_data: dict[str, Any],
        market_context: str = "",
        past_context: str = "",
    ) -> dict[str, Any]:
        reports: dict[str, dict[str, Any]] = {}
        for role in ROLES:
            try:
                report = self._run_analyst(role, fund_data, market_context, past_context)
                reports[role] = report
                logger.info(f"分析师 {role} 完成")
            except Exception as e:
                logger.error(f"分析师 {role} 执行失败: {e}")
                reports[role] = self._default_report(role)

        result = Supervisor(**self._llm_kwargs).synthesize(reports, fund_data, market_context, past_context)
        result["analyst_reports"] = [reports.get(r, self._default_report(r)) for r in ROLES]
        return result

    def _run_analyst(
        self,
        role: str,
        fund_data: dict[str, Any],
        market_context: str,
        past_context: str,
    ) -> dict[str, Any]:
        if role == "performance":
            return PerformanceAnalyst(**self._llm_kwargs).analyze(fund_data, market_context, past_context)
        elif role == "holding":
            return HoldingAnalyst(**self._llm_kwargs).analyze(fund_data, market_context, past_context)
        elif role == "manager":
            return ManagerAnalyst(**self._llm_kwargs).analyze(fund_data, market_context, past_context)
        elif role == "market":
            return MarketContextAnalyst(**self._llm_kwargs).analyze(fund_data, market_context, past_context)
        raise ValueError(f"未知分析师角色: {role}")

    @staticmethod
    def _default_report(role: str) -> dict[str, Any]:
        return {
            "analyst_role": role,
            "thesis": "分析未完成",
            "score": 5,
            "key_evidence": ["执行异常"],
            "risk_flags": [],
        }
