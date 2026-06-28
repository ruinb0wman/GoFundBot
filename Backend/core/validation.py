from functools import wraps
from typing import Type

from flask import request, jsonify, g
from pydantic import BaseModel, ValidationError


def validate_body(schema: Type[BaseModel]):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            data = request.get_json(silent=True) or {}
            try:
                g.validated_body = schema.model_validate(data)
            except ValidationError as e:
                return jsonify({
                    "code": "VALIDATION_ERROR",
                    "message": "请求参数校验失败",
                    "detail": e.errors(include_input=False),
                }), 422
            return f(*args, **kwargs)
        return wrapper
    return decorator


def validate_query(schema: Type[BaseModel]):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            data = dict(request.args)
            try:
                g.validated_query = schema.model_validate(data)
            except ValidationError as e:
                return jsonify({
                    "code": "VALIDATION_ERROR",
                    "message": "查询参数校验失败",
                    "detail": e.errors(include_input=False),
                }), 422
            return f(*args, **kwargs)
        return wrapper
    return decorator
