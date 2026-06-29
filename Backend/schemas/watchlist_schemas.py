from pydantic import BaseModel, field_validator


class AddWatchlistSchema(BaseModel):
    fund_code: str
    fund_name: str = ""
    fund_type: str = ""
    group_id: int | None = None
    estimate: dict | None = None

    @field_validator("fund_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip()
        if not (6 <= len(v) <= 8):
            raise ValueError("基金代码长度应在 6-8 位之间")
        if not v.isdigit():
            raise ValueError("基金代码必须为数字")
        return v


class BatchDeleteSchema(BaseModel):
    fund_codes: list[str]

    @field_validator("fund_codes")
    @classmethod
    def check_codes(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("fund_codes 不能为空")
        if len(v) > 100:
            raise ValueError("单次最多删除 100 个基金")
        return v


class ReorderSchema(BaseModel):
    fund_codes: list[str]

    @field_validator("fund_codes")
    @classmethod
    def check_codes(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("fund_codes 不能为空")
        return v


class MoveFundSchema(BaseModel):
    fund_code: str
    group_id: int | None = None

    @field_validator("fund_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip()
        if not (6 <= len(v) <= 8):
            raise ValueError("基金代码长度应在 6-8 位之间")
        return v


class CreateGroupSchema(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("分组名称不能为空")
        if len(v) > 20:
            raise ValueError("分组名称不能超过 20 个字符")
        return v
