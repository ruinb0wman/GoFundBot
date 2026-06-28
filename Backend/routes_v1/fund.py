"""API v1 基金相关路由。

渐进迁移策略：v1 端点直接调用底层服务模块，
避免与 app.py 中的旧路由产生耦合。
"""

from flask import Blueprint, jsonify, request
from flasgger import swag_from
from services.data_service_client import DataServiceError, get_data_service_client
from services.data_service_legacy_mapper import map_data_service_detail_to_legacy
from core.logging import get_logger
from schemas.apidoc import FUND_DETAIL, FUND_SEARCH

logger = get_logger(__name__)

fund_bp = Blueprint('fund_v1', __name__, url_prefix='/fund')


@fund_bp.route('/<fund_code>', methods=['GET'])
@swag_from(FUND_DETAIL)
def get_fund_detail(fund_code):
    """获取基金完整详情 v1"""
    source = request.args.get('source', 'auto')
    try:
        ds_payload = get_data_service_client().get_fund_detail(fund_code)
        ds_data = ds_payload.get('data', {}) if isinstance(ds_payload, dict) else {}
        if ds_data:
            mapped = map_data_service_detail_to_legacy(fund_code, ds_data)
            if source == 'data_service':
                return jsonify({"success": True, "data": mapped.get('data', {})})
            return jsonify(mapped)
        return jsonify({"success": False, "error": "DataService 返回空数据"}), 502
    except DataServiceError as e:
        logger.error(f"v1 fund detail: DataService unavailable for {fund_code}", exc_info=e)
        return jsonify({"success": False, "error": str(e)}), 503


@fund_bp.route('/search', methods=['GET'])
@swag_from(FUND_SEARCH)
def search_funds():
    """基金搜索 v1"""
    keyword = request.args.get('q', '')
    if not keyword:
        return jsonify({"error": "Keyword is required"}), 400
    try:
        ds_payload = get_data_service_client().search_funds(keyword)
        ds_data = ds_payload.get('data', {}) if isinstance(ds_payload, dict) else {}
        ds_items = ds_data.get('items', []) if isinstance(ds_data, dict) else []
        if ds_items:
            funds = [{
                'code': item.get('code', ''),
                'name': item.get('name', ''),
                'type': item.get('type', ''),
            } for item in ds_items if isinstance(item, dict)]
            return jsonify({"data": funds})
        return jsonify({"data": []})
    except DataServiceError as e:
        logger.error(f"v1 fund search: DataService unavailable", exc_info=e)
        from fund_list_cache import FundListCache
        cache = FundListCache()
        funds = cache.search(keyword, limit=20)
        return jsonify({"data": funds})
