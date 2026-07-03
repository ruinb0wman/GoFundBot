"""
GoFundBot Backend — 精简入口模块
Flask 应用初始化、Blueprint 注册、中间件、启动/关闭钩子。
"""

import atexit
import signal
import sys
import threading
import time
from datetime import datetime

from flasgger import Swagger
from flask import Flask, g, request
from flask_compress import Compress
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import desc

from config import ConfigValidationError, get_config
from core.cache_headers import apply_cache_headers
from core.cors_config import parse_cors_origins
from core.logging import get_logger, init_logging
from core.metrics import http_request_duration_seconds, http_requests_total
from database import SessionLocal, init_db
from models import DataFetchTask

logger = get_logger(__name__)


# ============================================================================
# Flask app 创建 & 中间件
# ============================================================================

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app, origins=parse_cors_origins())
Compress(app)

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://",
)
limiter.init_app(app)

Swagger(
    app,
    template={
        "swagger": "2.0",
        "info": {
            "title": "GoFundBot API",
            "description": "基金数据服务平台 API 文档。\n\n基础路径: `/api/` (旧) / `/api/v1/` (新)",
            "version": "0.1.0",
            "contact": {"name": "GoFundBot"},
        },
        "basePath": "/",
        "schemes": ["http"],
        "tags": [
            {"name": "Fund", "description": "基金查询与搜索"},
            {"name": "System", "description": "系统管理与监控"},
        ],
    },
)


# ============================================================================
# Prometheus 请求埋点
# ============================================================================


@app.before_request
def before_request_metrics():
    g._request_start_time = time.time()


@app.after_request
def after_request_metrics(response):
    start = getattr(g, "_request_start_time", None)
    if start and response.status_code < 400:
        path = request.path
        duration = time.time() - start
        http_request_duration_seconds.labels(method=request.method, path=path).observe(duration)
        http_requests_total.labels(method=request.method, path=path, status=response.status_code).inc()
    return apply_cache_headers(response)


# ============================================================================
# 数据库会话
# ============================================================================


def get_db():
    if "db" not in g:
        g.db = SessionLocal()
    return g.db


@app.teardown_appcontext
def teardown_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# ============================================================================
# 蓝图注册
# ============================================================================

# 现有蓝图
from data_service_routes import data_service_bp
from fund_master_routes import fund_master_bp
from routes.alert_routes import alert_bp
from routes.backtest_routes import backtest_bp

# 新拆分蓝图
from routes.chat_routes import chat_bp
from routes.fund_routes import fund_bp
from routes.log_routes import log_bp
from routes.research_routes import research_bp
from routes.screening_routes import screening_bp
from routes.system_routes import system_bp
from routes.user_portfolio import user_portfolio_bp
from routes.watchlist_routes import watchlist_bp
from routes_v1 import register_v1_blueprints

app.register_blueprint(chat_bp)
app.register_blueprint(fund_master_bp)
app.register_blueprint(data_service_bp)
app.register_blueprint(fund_bp)
app.register_blueprint(watchlist_bp)
app.register_blueprint(screening_bp)
app.register_blueprint(research_bp)
app.register_blueprint(backtest_bp)
app.register_blueprint(system_bp)
app.register_blueprint(alert_bp)
app.register_blueprint(log_bp)
app.register_blueprint(user_portfolio_bp)
register_v1_blueprints(app)

# === SQLite 管理界面（仅开发模式 / ENABLE_SQLITE_ADMIN=true） ===
from routes.sqlite_admin import create_admin
from routes.sqlite_admin import is_enabled as _admin_enabled

if _admin_enabled(app):
    create_admin(app)
    logger.info("SQLite 管理界面已启用 → http://localhost:5000/sqlite-admin")


# ============================================================================
# 初始化
# ============================================================================

init_db()


# ============================================================================
# 服务预加载 & 后台调度
# ============================================================================


def preload_services():
    def _preload():
        time.sleep(2)
        try:
            from ai_service import get_ai_service

            ai_service = get_ai_service()
            if ai_service.is_available():
                logger.info("AI 服务已就绪（硅基流动 API）")
        except Exception as e:
            logger.error("Preload failed", extra={"error": str(e)})

    threading.Thread(target=_preload, daemon=True).start()


def _cleanup_stale_tasks_on_startup():
    try:
        db = SessionLocal()
        stale = db.query(DataFetchTask).filter(DataFetchTask.status == "running").all()
        for task in stale:
            task.status = "failed"
            task.message = "服务器重启，任务中断"
            task.finished_time = datetime.now()
            task.updated_time = datetime.now()
        if stale:
            db.commit()
            logger.info(f"[启动清理] 已将 {len(stale)} 个残留任务标记为失败")
        db.close()
    except Exception as e:
        logger.error("[启动清理] 失败", extra={"error": str(e)})


def _auto_ranking_scheduler():
    def _run_weekly():
        from models import FundScreeningRank
        from services.screening_engine import calculate_same_type_rankings

        while True:
            time.sleep(3600)
            try:
                db = SessionLocal()
                latest_ranking = db.query(FundScreeningRank).order_by(desc(FundScreeningRank.updated_time)).first()
                should_run = False
                if latest_ranking and latest_ranking.updated_time:
                    delta = datetime.now() - latest_ranking.updated_time
                    if delta.total_seconds() > 7 * 24 * 3600:
                        should_run = True
                else:
                    should_run = True
                db.close()

                if should_run:
                    logger.info("[自动排名] 开始每周同类排名计算...")
                    db2 = SessionLocal()
                    try:
                        calculate_same_type_rankings(db2)
                        db2.commit()
                        logger.info("[自动排名] 每周同类排名计算完成")
                    except Exception as e:
                        db2.rollback()
                        logger.error("[自动排名] 计算失败", extra={"error": str(e)})
                    finally:
                        db2.close()
            except Exception as e:
                logger.error("[自动排名] 调度检查失败", extra={"error": str(e)})

    t = threading.Thread(target=_run_weekly, daemon=True)
    t.start()
    logger.info("[自动排名] 后台周度排名调度已启动")


preload_services()


# ============================================================================
# 优雅关闭
# ============================================================================

_shutdown_flag = threading.Event()


def _graceful_shutdown():
    if _shutdown_flag.is_set():
        return
    _shutdown_flag.set()
    logger.info("收到关闭信号，开始优雅退出...")
    timeout = 10
    deadline = time.time() + timeout
    for thread in threading.enumerate():
        if thread is not threading.main_thread() and thread.is_alive():
            remaining = deadline - time.time()
            if remaining > 0:
                thread.join(timeout=remaining)
    logger.info("优雅关闭完成")


atexit.register(_graceful_shutdown)
signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))
signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))


# ============================================================================
# 主入口
# ============================================================================

if __name__ == "__main__":
    init_logging()
    logger.info("GoFundBot Backend 启动中...")
    try:
        get_config().validate()
        logger.info("配置校验通过")
    except ConfigValidationError as e:
        logger.error(f"配置校验失败:\n{e}")
        sys.exit(1)
    _cleanup_stale_tasks_on_startup()
    _auto_ranking_scheduler()
    logger.info("GoFundBot Backend 已就绪")
    try:
        app.run(debug=False, host="0.0.0.0", port=5000, threaded=True)
    finally:
        _graceful_shutdown()
