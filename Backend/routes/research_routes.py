import threading
from datetime import datetime
from flask import Blueprint, jsonify, request

from core.logging import get_logger
from database import get_request_db as get_db, SessionLocal
from models import FundIndustryPerformance, DataFetchTask
from services.fund_industry import _industry_performance_payload
from services.research import (
    _build_research_market_stats, _build_research_fund_dashboard,
    _build_research_etf_tracking, _build_etf_tracking_snapshot,
    _build_research_sector_summary, _task_to_research_status,
    _latest_research_industry_task, _run_research_industry_performance_rebuild,
)
from services.screening_engine import _is_active_task, _create_data_fetch_task

logger = get_logger(__name__)

research_bp = Blueprint('research', __name__, url_prefix='/api/research')


@research_bp.route('/market-stats', methods=['GET'])
def get_research_market_stats():
    db = get_db()
    return jsonify(_build_research_market_stats(db))


@research_bp.route('/fund-dashboard', methods=['GET'])
def get_research_fund_dashboard():
    db = get_db()
    limit = request.args.get('limit', 5, type=int)
    return jsonify(_build_research_fund_dashboard(db, limit=max(1, min(limit, 20))))


@research_bp.route('/etf-tracking', methods=['GET'])
def get_research_etf_tracking():
    db = get_db()
    limit = request.args.get('limit', 80, type=int)
    refresh = str(request.args.get('refresh', '')).lower() in ('1', 'true', 'yes')
    if refresh:
        return jsonify(_build_etf_tracking_snapshot(db, limit=max(10, min(limit, 300)), refresh=True))
    return jsonify(_build_research_etf_tracking(db, limit=max(10, min(limit, 300))))


@research_bp.route('/sector-summary', methods=['GET'])
def get_research_sector_summary():
    limit = request.args.get('limit', 50, type=int)
    return jsonify(_build_research_sector_summary(limit=max(10, min(limit, 200))))


@research_bp.route('/industry-performance', methods=['GET'])
def get_research_industry_performance():
    db = get_db()
    if db.query(FundIndustryPerformance).count() == 0:
        latest_task = _latest_research_industry_task(db)
        if not _is_active_task(latest_task):
            task = _create_data_fetch_task(db, 'research_industry_performance', {}, message='后台汇总板块行情...')
            thread = threading.Thread(target=_run_research_industry_performance_rebuild, args=(task.id,), daemon=True)
            thread.start()
            latest_task = task
    payload = _industry_performance_payload(db)
    payload['task_status'] = _task_to_research_status(_latest_research_industry_task(db))
    return jsonify(payload)


@research_bp.route('/rebuild-industry-performance', methods=['POST'])
def rebuild_research_industry_performance():
    db = get_db()
    latest_task = _latest_research_industry_task(db)
    if _is_active_task(latest_task):
        return jsonify({
            'success': True, 'already_running': True,
            'task_status': _task_to_research_status(latest_task),
            'data': _industry_performance_payload(db),
        }), 202

    task = _create_data_fetch_task(db, 'research_industry_performance', {}, message='后台汇总板块行情...')
    thread = threading.Thread(target=_run_research_industry_performance_rebuild, args=(task.id,), daemon=True)
    thread.start()
    return jsonify({
        'success': True, 'accepted': True,
        'task_status': _task_to_research_status(task),
        'data': _industry_performance_payload(db),
    }), 202


@research_bp.route('/dashboard', methods=['GET'])
def get_research_dashboard():
    db = get_db()
    limit = request.args.get('limit', 5, type=int)
    etf_limit = request.args.get('etf_limit', 80, type=int)
    if db.query(FundIndustryPerformance).count() == 0:
        latest_task = _latest_research_industry_task(db)
        if not _is_active_task(latest_task):
            task = _create_data_fetch_task(db, 'research_industry_performance', {}, message='后台汇总板块行情...')
            thread = threading.Thread(target=_run_research_industry_performance_rebuild, args=(task.id,), daemon=True)
            thread.start()
    return jsonify({
        "market_stats": _build_research_market_stats(db),
        "fund_dashboard": _build_research_fund_dashboard(db, limit=max(1, min(limit, 20))),
        "etf_tracking": _build_research_etf_tracking(db, limit=max(10, min(etf_limit, 300))),
        "industry_performance": _industry_performance_payload(db),
        "industry_performance_task": _task_to_research_status(_latest_research_industry_task(db)),
        "updated_at": datetime.now().isoformat(),
        "data_source": {
            "primary": "funds.db",
            "industry_performance": "funds.db fund industry tags + screening performance",
            "etf_net_flow": "not_available",
        },
    })



