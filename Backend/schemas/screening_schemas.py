from typing import Optional
from pydantic import BaseModel, field_validator


class ScreeningQuerySchema(BaseModel):
    fund_type: Optional[str] = None
    keyword: Optional[str] = None
    min_return_1y: Optional[float] = None
    max_return_1y: Optional[float] = None
    min_sharpe_1y: Optional[float] = None
    max_drawdown_1y: Optional[float] = None
    min_volatility_1y: Optional[float] = None
    max_volatility_1y: Optional[float] = None
    pass_4433: Optional[bool] = None
    industry_tag: Optional[str] = None
    min_scale: Optional[float] = None
    max_scale: Optional[float] = None
    sort_by: Optional[str] = None
    sort_order: Optional[str] = "desc"
    page: int = 1
    page_size: int = 20

    @field_validator("page")
    @classmethod
    def check_page(cls, v: int) -> int:
        if v < 1:
            return 1
        if v > 1000:
            return 1000
        return v

    @field_validator("page_size")
    @classmethod
    def check_page_size(cls, v: int) -> int:
        if v < 1:
            return 20
        if v > 200:
            return 200
        return v

    @field_validator("sort_order")
    @classmethod
    def check_order(cls, v: str) -> str:
        if v not in ("asc", "desc"):
            return "desc"
        return v
