"""API v1 路由蓝图的统一注册入口。

本模块集中注册所有 v1 子蓝图到主蓝图，
然后由 app.py 统一挂载。
"""

from flask import Blueprint

api_v1 = Blueprint("api_v1", __name__, url_prefix="/api/v1")


def register_v1_blueprints(app):
    """在主 Flask 应用上注册 api_v1 及其子蓝图。"""
    from .fund import fund_bp

    api_v1.register_blueprint(fund_bp)
    app.register_blueprint(api_v1)
