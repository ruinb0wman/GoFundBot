from pydantic import BaseModel, field_validator


class FixedInvestmentSchema(BaseModel):
    model_config = {"extra": "ignore"}

    fund_code: str
    start_date: str = ""
    end_date: str = ""
    investment_type: str = "monthly"
    amount: float = 1000
    initial_amount: float = 0
    fee_rate: float = 0.15
    take_profit_rate: float | None = None
    stop_loss_rate: float | None = None

    @field_validator("fund_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("基金代码不能为空")
        return v

    @field_validator("start_date", "end_date")
    @classmethod
    def check_date(cls, v: str) -> str:
        if not v:
            return v
        if not v.strip():
            return v
        import re

        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("日期格式必须是 YYYY-MM-DD")
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
        allowed = {"monthly", "weekly", "daily", "lump_sum"}
        if v not in allowed:
            raise ValueError(f"定投类型必须是 {allowed} 之一")
        return v

    @field_validator("fee_rate")
    @classmethod
    def check_fee(cls, v: float) -> float:
        if v < 0 or v > 5.0:
            raise ValueError("费率必须在 0-5% 之间")
        return v

    @field_validator("take_profit_rate", "stop_loss_rate")
    @classmethod
    def check_rate(cls, v: float | None) -> float | None:
        if v is not None and (v < 0 or v > 500):
            raise ValueError("止盈/止损率必须在 0-500% 之间")
        return v
