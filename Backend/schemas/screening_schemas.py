from pydantic import BaseModel, field_validator


class ScreeningQuerySchema(BaseModel):
    fund_type: str | None = None
    keyword: str | None = None
    min_return_1y: float | None = None
    max_return_1y: float | None = None
    min_sharpe_1y: float | None = None
    max_drawdown_1y: float | None = None
    min_volatility_1y: float | None = None
    max_volatility_1y: float | None = None
    pass_4433: bool | None = None
    industry_tag: str | None = None
    min_scale: float | None = None
    max_scale: float | None = None
    sort_by: str | None = None
    sort_order: str | None = "desc"
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
