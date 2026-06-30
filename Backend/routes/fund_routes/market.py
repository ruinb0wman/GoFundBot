import re

import requests as req
import urllib3
from flask import jsonify, request

from core.logging import get_logger

from . import fund_bp

urllib3.disable_warnings()

logger = get_logger(__name__)


@fund_bp.route("/api/eastmoney/<path:subpath>", methods=["GET"])
def proxy_eastmoney(subpath):
    target_url = f"https://push2.eastmoney.com/{subpath}"
    query_string = request.query_string.decode("utf-8")
    if query_string:
        target_url = f"{target_url}?{query_string}"

    base_headers = {
        "Referer": "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }

    errors = []
    for use_env_proxy in [True, False]:
        try:
            s = req.Session()
            s.trust_env = use_env_proxy
            resp = s.get(target_url, headers=base_headers, timeout=10, verify=False)
            if resp.status_code == 200:
                return jsonify(resp.json())
        except Exception as exc:
            errors.append(f"{'env-proxy' if use_env_proxy else 'direct'}: {str(exc)[:80]}")

    try:
        from curl_cffi import requests as curl_requests

        for impersonate_target in ("chrome124", "chrome120", "chrome110", "chrome101", "edge101"):
            try:
                resp = curl_requests.get(
                    target_url, headers=base_headers, timeout=10, verify=False, impersonate=impersonate_target
                )
                if resp.status_code == 200:
                    return jsonify(resp.json())
            except Exception:
                continue
    except Exception as exc:
        errors.append(f"curl_cffi: {str(exc)[:80]}")

    try:
        resp = req.get(target_url, headers=base_headers, timeout=10)
        if resp.status_code == 200:
            return jsonify(resp.json())
    except Exception as exc:
        errors.append(f"default: {str(exc)[:80]}")

    logger.warning(f"东方财富代理全部失败: {'; '.join(errors)}")
    return jsonify({"error": "东方财富代理请求失败", "details": errors}), 502


@fund_bp.route("/api/stock/<code>/quote", methods=["GET"])
def get_stock_quote(code):
    try:
        from services.market_data import get_market_data_service as get_mds

        mds = get_mds()
        quote = mds.get_realtime_quote(code, use_cache=True)
        if not quote:
            return jsonify({"success": False, "error": f"未找到股票 {code} 的行情数据"}), 404
        return jsonify({"success": True, "data": quote})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@fund_bp.route("/api/stock/<code>/kline", methods=["GET"])
def get_stock_kline(code):
    period = request.args.get("period", "daily")
    adjust = request.args.get("adjust", "qfq")
    start_date = request.args.get("startDate", "")
    end_date = request.args.get("endDate", "")
    try:
        normalized_code = re.sub(r"^(sh|sz|bj|SH|SZ|BJ)|\.(SH|SZ|BJ)$", "", code.strip())
        from services.market_data import get_market_data_service as get_mds

        mds = get_mds()
        result = mds.get_a_stock_kline(
            normalized_code, klt=period, fqt=adjust, start_date=start_date, end_date=end_date
        )
        if not result.get("success"):
            return jsonify(result), 404
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@fund_bp.route("/api/market/daily", methods=["GET"])
def get_daily_market():
    try:
        from ai_service import get_ai_service

        ai_service = get_ai_service()
        if not ai_service.is_available():
            return jsonify({"error": "AI service not configured. Please set LLM_API_KEY in .env"}), 503
        from fund_master_service import FundMasterService
        from services.market_data import get_market_data_service as get_mds

        service = FundMasterService()
        mds = get_mds()
        market_data = {
            "indices": service.get_market_overview(),
            "sectors": mds.get_industry_boards(page_size=500),
            "news": service.get_flash_news()[:10],
        }
        result = ai_service.generate_market_summary(market_data)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
