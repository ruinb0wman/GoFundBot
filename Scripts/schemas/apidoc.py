"""Swagger 通用响应模型用于 @swag_from 引用。

使用方式：
    @swag_from(apidoc.FUND_DETAIL)
    def get_fund_detail(fund_code): ...
"""


# ── 通用响应 ──

SUCCESS_RESPONSE = {
    200: {
        "description": "请求成功",
        "schema": {
            "type": "object",
            "properties": {
                "success": {"type": "boolean", "example": True},
                "data": {"type": "object"},
            },
        },
    },
}

ERROR_400 = {
    "description": "参数错误",
    "schema": {
        "type": "object",
        "properties": {
            "error": {"type": "string"},
        },
    },
}

ERROR_404 = {
    "description": "资源未找到",
    "schema": {
        "type": "object",
        "properties": {
            "success": {"type": "boolean", "example": False},
            "error": {"type": "string"},
        },
    },
}

ERROR_500 = {
    "description": "服务器内部错误",
    "schema": {
        "type": "object",
        "properties": {
            "success": {"type": "boolean", "example": False},
            "error": {"type": "string"},
        },
    },
}

# ── Fund 端点 ──

FUND_DETAIL = {
    "tags": ["Fund"],
    "summary": "获取基金完整详情",
    "parameters": [
        {
            "name": "fund_code",
            "in": "path",
            "type": "string",
            "required": True,
            "description": "基金代码（如 000001）",
        },
        {
            "name": "source",
            "in": "query",
            "type": "string",
            "enum": ["auto", "legacy", "data_service"],
            "default": "auto",
            "description": "数据源选择",
        },
    ],
    "responses": {
        200: {"description": "基金详情（含基本信息、净值趋势、持仓、风险指标等）"},
        404: {"description": "基金未找到"},
        503: {"description": "数据源不可用"},
    },
}

FUND_SEARCH = {
    "tags": ["Fund"],
    "summary": "搜索基金",
    "parameters": [
        {
            "name": "q",
            "in": "query",
            "type": "string",
            "required": True,
            "description": "搜索关键词（基金代码/名称/拼音）",
        },
    ],
    "responses": {
        200: {
            "description": "搜索结果列表",
            "schema": {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "code": {"type": "string"},
                                "name": {"type": "string"},
                                "type": {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
    },
}

# ── Health ──

HEALTH_CHECK = {
    "tags": ["System"],
    "summary": "服务健康检查",
    "responses": {
        200: {
            "description": "所有子系统正常",
            "schema": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "example": "ok"},
                    "service": {"type": "string", "example": "gofund-backend"},
                    "checks": {
                        "type": "object",
                        "properties": {
                            "database": {"type": "string"},
                            "data_service": {"type": "string"},
                        },
                    },
                },
            },
        },
        503: {
            "description": "部分子系统异常",
        },
    },
}
