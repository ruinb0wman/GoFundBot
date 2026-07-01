from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Rating(StrEnum):
    STRONG_BUY = "Strong Buy"
    BUY = "Buy"
    HOLD = "Hold"
    UNDERWEIGHT = "Underweight"
    SELL = "Sell"


ALLOWED_OPERATION_ADVICE = {"强烈推荐", "建议买入", "持有观望", "建议减仓", "建议卖出"}
ALLOWED_ANALYST_ROLES = {"bull", "bear", "performance", "holding", "manager", "market"}

EVAL_GRADE = {"优秀", "良好", "一般", "较差"}
POSITION_TYPE = {"集中", "均衡", "分散"}
OUTLOOK_TYPE = {"乐观", "中性", "谨慎"}


class DashboardEval(BaseModel):
    model_config = {"extra": "ignore"}

    performance_eval: Literal["优秀", "良好", "一般", "较差"]
    manager_ability: Literal["优秀", "良好", "一般", "较差"]
    position_analysis: Literal["集中", "均衡", "分散"]
    market_outlook: Literal["乐观", "中性", "谨慎"]


class AnalystReport(BaseModel):
    model_config = {"extra": "ignore"}

    analyst_role: str
    thesis: str = Field(min_length=20)
    score: int = Field(ge=0, le=10)
    key_evidence: list[str] = Field(min_length=1)
    risk_flags: list[str] = Field(default_factory=list)

    @field_validator("analyst_role")
    @classmethod
    def check_role(cls, v: str) -> str:
        if v not in ALLOWED_ANALYST_ROLES:
            raise ValueError(f"角色必须是 {ALLOWED_ANALYST_ROLES} 之一")
        return v


class FundAnalysisResult(BaseModel):
    model_config = {"extra": "ignore"}

    rating: str
    sentiment_score: int = Field(ge=0, le=100)
    operation_advice: str
    summary: str = Field(min_length=10, max_length=500)
    dashboard: DashboardEval
    highlights: list[str] = Field(min_length=1, max_length=10)
    risk_factors: list[str] = Field(min_length=1, max_length=10)
    news_intel: list[str] = Field(default_factory=list, max_length=10)
    detailed_report: str = Field(min_length=50)

    @field_validator("rating")
    @classmethod
    def check_rating(cls, v: str) -> str:
        allowed = {m.value for m in Rating}
        if v not in allowed:
            raise ValueError(f"评级必须是 {allowed} 之一")
        return v

    @field_validator("operation_advice")
    @classmethod
    def check_operation_advice(cls, v: str) -> str:
        if v not in ALLOWED_OPERATION_ADVICE:
            raise ValueError(f"操作建议必须是 {ALLOWED_OPERATION_ADVICE} 之一")
        return v
