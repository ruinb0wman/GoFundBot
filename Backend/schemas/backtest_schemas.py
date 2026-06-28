from typing import Optional
from pydantic import BaseModel, field_validator


class FixedInvestmentSchema(BaseModel):
    fund_code: str
    investment_type: str = "regular"
    amount: float
    initial_amount: float = 0
    fee_rate: float = 0.0
    take_profit_rate: Optional[float] = None
    stop_loss_rate: Optional[float] = None

    @field_validator("fund_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("基金代码不能为空")
        return v

    @field_validator("amount")
    @classmethod
    def check_amount(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("定投金额必须大于 0")
        if v > 1_000_000_000:
            raise ValueError("定投金额不能超过 10 亿")
        return v

    @field_validator("investment_type")
    @classmethod
    def check_type(cls, v: str) -> str:
        allowed = {"regular", "manual"}
        if v not in allowed:
            raise ValueError(f"定投类型必须是 {allowed} 之一")
        return v

    @field_validator("fee_rate")
    @classmethod
    def check_fee(cls, v: float) -> float:
        if v < 0 or v > 0.05:
            raise ValueError("费率必须在 0-0.05 之间")
        return v

    @field_validator("take_profit_rate", "stop_loss_rate")
    @classmethod
    def check_rate(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and (v < -1 or v > 10):
            raise ValueError("止盈/止损率必须在 -1 到 10 之间")
        return v
