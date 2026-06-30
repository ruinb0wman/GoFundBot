from flask import Response, jsonify, stream_with_context

from core.logging import get_logger
from fund_api import FundAPI
from services.helpers import _normalize_fund_code

from . import fund_bp

logger = get_logger(__name__)
fund_api = FundAPI()


@fund_bp.route("/api/fund/<fund_code>/analyze", methods=["GET"])
def analyze_fund(fund_code):
    fund_code = _normalize_fund_code(fund_code)
    if not fund_code:
        return jsonify({"error": "Fund code is required"}), 400
    fund_data = fund_api.get_fund_data(fund_code)
    if not fund_data:
        return jsonify({"error": "Fund data not found"}), 404
    try:
        from ai_service import get_ai_service

        ai_service = get_ai_service()
        if not ai_service.is_available():
            return jsonify({"error": "AI service not configured. Please set LLM_API_KEY in .env file."}), 503
        result = ai_service.analyze_fund(fund_data)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@fund_bp.route("/api/fund/<fund_code>/analyze/stream", methods=["POST"])
def analyze_fund_stream(fund_code):
    """SSE streaming AI fund analysis."""
    fund_code = _normalize_fund_code(fund_code)
    if not fund_code:
        return jsonify({"error": "Fund code is required"}), 400
    fund_data = fund_api.get_fund_data(fund_code)
    if not fund_data:
        return jsonify({"error": "Fund data not found"}), 404

    from ai_service import get_ai_service

    ai_service = get_ai_service()
    if not ai_service.is_available():
        return jsonify({"error": "AI service not configured"}), 503

    def generate():
        yield from ai_service.analyze_fund_stream(fund_data)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
