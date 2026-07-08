from pydantic import BaseModel, field_validator


class FundPortfolioCreateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    fund_code: str
    fund_name: str = ""
    fund_type: str = ""
    fund_data_json: dict | None = None
    sort_order: int = 0

    @field_validator("fund_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or len(v) != 6:
            raise ValueError("基金代码必须是 6 位数字")
        return v


class FundPortfolioBatchCreateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    funds: list[FundPortfolioCreateSchema]


class FundPortfolioReorderSchema(BaseModel):
    model_config = {"extra": "ignore"}

    fund_codes: list[str]


class TradeRecordCreateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    fund_code: str
    fund_name: str = ""
    type: str  # buy / sell
    trade_date: str = ""
    amount: float = 0
    share: float = 0
    nav: float = 0
    status: str = "settled"
    txn_id: str = ""
    settled_at: str = ""

    @field_validator("fund_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or len(v) != 6:
            raise ValueError("基金代码必须是 6 位数字")
        return v

    @field_validator("type")
    @classmethod
    def check_type(cls, v: str) -> str:
        if v not in ("buy", "sell", "adjustment"):
            raise ValueError("type 必须为 buy、sell 或 adjustment")
        return v


class TradeRecordUpdateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    status: str | None = None
    settled_at: str | None = None


class BatchSettleSchema(BaseModel):
    model_config = {"extra": "ignore"}

    txn_ids: list[str]


class PortfolioGroupCreateSchema(BaseModel):
    model_config = {"extra": "ignore"}

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


class PortfolioGroupUpdateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    name: str | None = None

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("分组名称不能为空")
            if len(v) > 20:
                raise ValueError("分组名称不能超过 20 个字符")
        return v


class FundGroupMapUpdateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    mappings: list[dict]


class PositionCreateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    fund_code: str
    fund_name: str = ""
    purchase_date: str = ""
    purchase_time: str = ""
    shares: float = 0
    cost: float = 0

    @field_validator("fund_code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or len(v) != 6:
            raise ValueError("基金代码必须是 6 位数字")
        return v


class PositionUpdateSchema(BaseModel):
    model_config = {"extra": "ignore"}

    fund_code: str | None = None
    fund_name: str | None = None
    purchase_date: str | None = None
    purchase_time: str | None = None
    shares: float | None = None
    cost: float | None = None


class MigratePayloadSchema(BaseModel):
    model_config = {"extra": "ignore"}

    funds: list[dict] = []
    tradeRecords: list[dict] = []
    pendingTxns: list[dict] = []
    fundOrder: list[str] = []
    groups: list[dict] = []
    groupMap: dict = {}
    positions: list[dict] = []
