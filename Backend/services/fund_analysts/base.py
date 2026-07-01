import json
import re
from typing import Any

from core.logging import get_logger

logger = get_logger(__name__)


class BaseAnalyst:
    def __init__(self, api_key: str, api_base: str, model: str):
        self._api_key = api_key
        self._api_base = api_base
        self._model = model

    def _call_llm(self, prompt: str, system_prompt: str, temperature: float = 0.3) -> str | None:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=self._api_key, base_url=self._api_base)
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]
            response = client.chat.completions.create(
                model=self._model,
                messages=messages,
                temperature=temperature,
                max_tokens=4096,
            )
            content = response.choices[0].message.content
            if not content:
                logger.error(f"{self.__class__.__name__}: LLM 返回空内容")
                return None
            return content
        except Exception as e:
            logger.error(f"{self.__class__.__name__}: LLM 调用失败: {e}")
            return None

    @staticmethod
    def _extract_json(raw: str) -> str:
        stripped = raw.strip()
        if stripped.startswith("{"):
            try:
                json.loads(stripped)
                return stripped
            except json.JSONDecodeError:
                pass
        blocks = list(re.finditer(r"```(?:json)?\s*([\s\S]*?)\s*```", raw))
        if blocks:
            return blocks[-1].group(1)
        decoder = json.JSONDecoder()
        pos = 0
        while True:
            start = stripped.find("{", pos)
            if start == -1:
                break
            try:
                obj, end = decoder.raw_decode(stripped, start)
                return stripped[start:end]
            except json.JSONDecodeError:
                pos = start + 1
        return raw

    @staticmethod
    def _format_past_context(ctx: str) -> str:
        if not ctx:
            return ""
        return f"{ctx}\n"

    @staticmethod
    def _format_market_context(market_ctx: str) -> str:
        if not market_ctx:
            return ""
        return f"## 当前市场环境\n{market_ctx}\n"

    @staticmethod
    def _format_fund_basic(fund_data: dict[str, Any]) -> str:
        basic = fund_data.get("basic_info", {})
        performance = fund_data.get("performance", {})
        risk = fund_data.get("risk_metrics", {})
        portfolio = fund_data.get("portfolio", {})
        managers = fund_data.get("fund_managers", [])

        lines = [
            f"- 名称：{basic.get('fund_name', '未知')}（{basic.get('fund_code', '未知')}）",
            f"- 类型：{basic.get('fund_type', '未知')}",
        ]
        perf = [
            ("近1月", performance.get("1_month_return")),
            ("近3月", performance.get("3_month_return")),
            ("近6月", performance.get("6_month_return")),
            ("近1年", performance.get("1_year_return")),
        ]
        perf_str = "、".join(f"{k}：{v}%" for k, v in perf if v is not None)
        if perf_str:
            lines.append(f"- 收益：{perf_str}")
        if risk:
            items = []
            if risk.get("sharpe_ratio") is not None:
                items.append(f"夏普 {risk['sharpe_ratio']}")
            if risk.get("max_drawdown") is not None:
                items.append(f"回撤 {risk['max_drawdown']}%")
            if risk.get("volatility") is not None:
                items.append(f"波动 {risk['volatility']}%")
            if items:
                lines.append(f"- 风险：{' | '.join(items)}")
        if managers:
            m = managers[0]
            parts = [m.get("name", "")]
            if m.get("work_experience"):
                parts.append(f"{m['work_experience']}年")
            if m.get("managed_fund_size"):
                parts.append(f"管理{m['managed_fund_size']}")
            if len(parts) > 1:
                lines.append(f"- 经理：{' | '.join(parts)}")
        stocks = portfolio.get("stock_codes", [])
        if stocks:
            names = []
            for s in stocks[:5]:
                if isinstance(s, dict):
                    names.append(s.get("name", s.get("code", "")))
                else:
                    names.append(str(s))
            if names:
                lines.append(f"- 重仓：{'、'.join(names)}")
        return "\n".join(lines)
