from functools import wraps
from flask import jsonify, request, current_app
from core.logging import get_logger

logger = get_logger(__name__)


def deprecated_route(sunset_version: str = "v2", alternative: str = ""):
    """标记旧路由为已废弃，返回 X-Deprecated 头。

    Usage:
        @app.route('/api/fund/<fund_code>')
        @deprecated_route(alternative='/api/v1/fund/<fund_code>')
        def old_handler(fund_code): ...
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            resp = f(*args, **kwargs)
            if isinstance(resp, tuple):
                body, status, headers = resp if len(resp) == 3 else (resp[0], resp[1], {})
                if not isinstance(headers, dict):
                    headers = {}
            elif isinstance(resp, current_app.response_class):
                body, status, headers = resp, resp.status_code, {}
            else:
                body, status, headers = resp, 200, {}

            if isinstance(headers, dict):
                headers['X-Deprecated'] = 'true'
                headers['Sunset'] = sunset_version
                if alternative:
                    headers['X-Alt-Route'] = alternative

            logger.warning(f"已废弃端点被调用: {request.method} {request.path}")
            return body, status, headers

        wrapper._deprecated = True
        return wrapper
    return decorator
