import os
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, send_from_directory
from sqlalchemy import text, func

from core.metrics import metrics_endpoint
from core.logging import get_logger
from database import SessionLocal, get_request_db as get_db
from models import (
    FundBasicInfo, FundTrend, FundRiskMetrics,
    FundScreeningRank, FundWatchlist,
)
from services.data_service_client import get_data_service_client

logger = get_logger(__name__)

system_bp = Blueprint('system', __name__, url_prefix='')

_START_TIME = datetime.now(timezone.utc)


@system_bp.route('/')
def hello():
    return jsonify({"message": "Fund Analysis API is running!"})


@system_bp.route('/health', methods=['GET'])
def health_check():
    checks = {}
    try:
        db = SessionLocal()
        db.execute(text('SELECT 1'))
        db.close()
        checks['database'] = 'ok'
    except Exception as e:
        checks['database'] = f'error: {e}'

    try:
        ds = get_data_service_client().health()
        if isinstance(ds, dict):
            checks['data_service'] = ds.get('status', 'unknown')
        else:
            checks['data_service'] = 'unknown'
    except Exception as e:
        checks['data_service'] = f'error: {str(e)[:200]}'

    all_ok = all(v == 'ok' for v in checks.values())
    return jsonify({
        'status': 'ok' if all_ok else 'degraded',
        'service': 'gofund-backend',
        'started_at': _START_TIME.isoformat(),
        'uptime_seconds': (datetime.now(timezone.utc) - _START_TIME).total_seconds(),
        'checks': checks,
    }), 200 if all_ok else 503


@system_bp.route('/metrics', methods=['GET'])
def metrics():
    return metrics_endpoint()


@system_bp.route('/api/data/stats', methods=['GET'])
def get_data_stats():
    db = get_db()
    stats = {
        'fund_basic_info': db.query(FundBasicInfo).count(),
        'fund_trend': db.query(FundTrend).count(),
        'fund_risk_metrics': db.query(FundRiskMetrics).filter(FundRiskMetrics.sharpe_ratio_1y.isnot(None)).count(),
        'fund_screening_rank': db.query(FundScreeningRank).count(),
        'fund_watchlist': db.query(FundWatchlist).count(),
        'pass_4433_count': db.query(FundScreeningRank).filter(FundScreeningRank.pass_4433 == 1).count(),
    }
    type_stats = db.query(FundBasicInfo.fund_type, func.count(FundBasicInfo.fund_code)).group_by(FundBasicInfo.fund_type).all()
    stats['by_type'] = {t: c for t, c in type_stats if t}
    return jsonify(stats)


@system_bp.route('/', defaults={'path': ''})
@system_bp.route('/<path:path>')
def serve_frontend(path):
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'static')
    if path and os.path.exists(os.path.join(static_dir, path)):
        return send_from_directory(static_dir, path)
    return send_from_directory(static_dir, 'index.html')
