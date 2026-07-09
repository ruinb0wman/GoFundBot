from datetime import datetime, timedelta

from sqlalchemy import desc

from core.logging import get_logger
from models import AnalysisMemory

logger = get_logger(__name__)

RESOLVE_AFTER_DAYS = 7


class AnalysisMemoryLog:
    def __init__(self, api_key: str, api_base: str, model: str):
        self._api_key = api_key
        self._api_base = api_base
        self._model = model

    def store_analysis(self, fund_code: str, result: dict | None) -> None:
        if not result or "rating" not in result:
            return
        from database import SessionLocal

        db = SessionLocal()
        try:
            record = AnalysisMemory(
                fund_code=fund_code,
                analysis_date=datetime.now(),
                rating=str(result.get("rating", "")),
                sentiment_score=result.get("sentiment_score", 50),
                thesis=(result.get("summary") or "")[:500],
            )
            db.add(record)
            db.commit()
        except Exception as e:
            logger.error(f"存储分析记录失败: {e}")
            db.rollback()
        finally:
            db.close()

    def resolve_pending(self, fund_code: str) -> None:
        from database import SessionLocal

        db = SessionLocal()
        try:
            pending = (
                db.query(AnalysisMemory)
                .filter(AnalysisMemory.fund_code == fund_code, AnalysisMemory.resolved == 0)
                .all()
            )
            if not pending:
                return

            cutoff = datetime.now() - timedelta(days=RESOLVE_AFTER_DAYS)
            to_resolve = [p for p in pending if p.analysis_date and p.analysis_date < cutoff]
            if not to_resolve:
                return

            current_data = self._fetch_current_data(fund_code)
            for record in to_resolve:
                actual_return = self._compute_return(current_data)
                reflection = self._generate_reflection(
                    record.fund_code, record.rating, record.thesis, record.sentiment_score, actual_return
                )
                record.actual_return = actual_return
                record.reflection = reflection
                record.resolved = 1
                record.resolved_date = datetime.now()

            db.commit()
            if to_resolve:
                logger.info(f"已结算 {fund_code} 的 {len(to_resolve)} 条待反思分析")
        except Exception as e:
            logger.error(f"结算分析记录失败: {e}")
            db.rollback()
        finally:
            db.close()

    def get_past_context(self, fund_code: str, n: int = 3) -> str:
        from database import SessionLocal

        db = SessionLocal()
        try:
            records = (
                db.query(AnalysisMemory)
                .filter(AnalysisMemory.fund_code == fund_code, AnalysisMemory.resolved == 1)
                .order_by(desc(AnalysisMemory.analysis_date))
                .limit(n)
                .all()
            )
            if not records:
                return ""

            parts = ["## 历史分析回顾"]
            for i, r in enumerate(records, 1):
                date_str = r.analysis_date.strftime("%Y-%m-%d") if r.analysis_date else "?"
                parts.append(f"\n---\n### 第{i}次分析（{date_str}）")
                parts.append(f"- 评级：{r.rating}")
                if r.actual_return is not None:
                    sign = "+" if r.actual_return >= 0 else ""
                    parts.append(f"- 近一月实际收益：{sign}{r.actual_return:.2f}%")
                if r.reflection:
                    parts.append(f"- 事后反思：{(r.reflection or '')[:300]}")
            return "\n".join(parts)
        finally:
            db.close()

    @staticmethod
    def _fetch_current_data(fund_code: str) -> dict:
        try:
            from services.data_service_client import get_data_service_client

            client = get_data_service_client()
            payload = client.get_fund_detail(fund_code)
            return payload.get("data", {}) if isinstance(payload, dict) else {}
        except Exception as e:
            logger.warning(f"获取 {fund_code} 当前数据失败: {e}")
            return {}

    @staticmethod
    def _compute_return(current_data: dict) -> float | None:
        try:
            perf = current_data.get("sections", {}).get("performance", {}).get("data", {})
            if not isinstance(perf, dict):
                return None
            return_1m = perf.get("return1m")
            if return_1m is not None:
                return float(return_1m)
            return_3m = perf.get("return3m")
            if return_3m is not None:
                return float(return_3m) / 3
            return None
        except (TypeError, ValueError):
            return None

    def _generate_reflection(
        self,
        fund_code: str,
        rating: str | None,
        thesis: str | None,
        sentiment_score: int | None,
        actual_return: float | None,
    ) -> str | None:
        if actual_return is None:
            return None

        direction = "正确" if actual_return >= 0 else "有误"
        sentiment_note = (
            "看多"
            if sentiment_score and sentiment_score > 50
            else "看空"
            if sentiment_score and sentiment_score < 50
            else "中性"
        )

        try:
            from openai import OpenAI

            client = OpenAI(api_key=self._api_key, base_url=self._api_base)
            system_prompt = "你是一位基金分析反思助手。请基于之前的分析结论和实际收益，用1-2句话总结具体经验教训。"
            prompt = (
                f"之前对基金{fund_code}的分析评级为{rating}（{sentiment_note}），"
                f"核心理由：{(thesis or '')[:300]}\n"
                f"该基金近期实际收益为{actual_return:+.2f}%。\n"
                f"请分析之前判断{direction}的原因，并给出一条具体学习经验。"
            )
            response = client.chat.completions.create(
                model=self._model,
                messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=256,
            )
            content = response.choices[0].message.content
            return content.strip() if content else self._template_reflection(direction)
        except Exception as e:
            logger.warning(f"反思 LLM 调用失败，使用模板: {e}")
            return self._template_reflection(direction)

    @staticmethod
    def _template_reflection(direction: str) -> str:
        if direction == "正确":
            return "本次判断方向正确，看多逻辑得到验证。后续应继续关注关键假设是否持续成立。"
        return "本次判断方向有误，风险因素被低估。后续分析应更重视下行风险。"
