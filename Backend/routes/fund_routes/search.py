from flask import jsonify, request

from core.logging import get_logger
from fund_list_cache import get_fund_list_cache
from services.data_service_client import DataServiceError, get_data_service_client

from . import fund_bp

logger = get_logger(__name__)
fund_list_cache = get_fund_list_cache()


@fund_bp.route("/api/fund/search", methods=["GET"])
def search_funds():
    keyword = request.args.get("q", "")
    if not keyword:
        return jsonify({"error": "Keyword is required"}), 400

    try:
        ds_payload = get_data_service_client().search_funds(keyword)
        ds_data = ds_payload.get("data", {}) if isinstance(ds_payload, dict) else {}
        ds_items = ds_data.get("items", []) if isinstance(ds_data, dict) else []
        if ds_items:
            funds = [
                {
                    "CODE": item.get("code", ""),
                    "NAME": item.get("name", ""),
                    "TYPE": item.get("type", ""),
                    "PINYIN": item.get("pinyin", ""),
                }
                for item in ds_items
                if isinstance(item, dict)
            ]
            return jsonify({"data": funds})
    except DataServiceError as e:
        logger.error(f"fund search: DataService unavailable, fallback to local cache: {e}")

    funds = fund_list_cache.search(keyword, limit=20)
    return jsonify({"data": funds})


@fund_bp.route("/api/fund/search/status", methods=["GET"])
def get_search_status():
    return jsonify(fund_list_cache.get_status())


@fund_bp.route("/api/fund/search/update", methods=["POST"])
def update_search_database():
    result = fund_list_cache.update_from_api()
    if result["success"]:
        return jsonify(result)
    return jsonify(result), 500
