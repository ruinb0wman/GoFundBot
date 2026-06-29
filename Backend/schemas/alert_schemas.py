from pydantic import BaseModel, field_validator


class AlertRuleCreateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    fund_code: str
    alert_type: str  # price_up / price_down / return_above / return_below
    threshold: float

    @field_validator("fund_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("基金代码不能为空")
        if not v.isdigit() or len(v) != 6:
            raise ValueError("基金代码必须是 6 位数字")
        return v

    @field_validator("alert_type")
    @classmethod
    def check_type(cls, v: str) -> str:
        allowed = {"price_up", "price_down", "return_above", "return_below"}
        if v not in allowed:
            raise ValueError(f"告警类型必须是 {allowed} 之一")
        return v

    @field_validator("threshold")
    @classmethod
    def check_threshold(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("阈值必须大于 0")
        if v > 1000:
            raise ValueError("阈值不能超过 1000%")
        return v


class AlertRuleUpdateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    threshold: float | None = None
    enabled: int | None = None

    @field_validator("threshold")
    @classmethod
    def check_threshold(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("阈值必须大于 0")
        if v is not None and v > 1000:
            raise ValueError("阈值不能超过 1000%")
        return v

    @field_validator("enabled")
    @classmethod
    def check_enabled(cls, v: int | None) -> int | None:
        if v is not None and v not in (0, 1):
            raise ValueError("enabled 必须是 0 或 1")
        return v
