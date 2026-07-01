import json
from datetime import UTC, datetime

from flask import Blueprint, jsonify, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from core.logging import append_log_entry, get_log_file_path, get_logger, list_log_files

logger = get_logger(__name__)

log_bp = Blueprint("logs", __name__, url_prefix="/api/logs")

limiter = Limiter(key_func=get_remote_address, storage_uri="memory://")


@log_bp.route("/list", methods=["GET"])
def list_logs():
    files = list_log_files()
    levels = {}
    for f in files:
        s = f["source"]
        if s not in levels:
            levels[s] = []
        levels[s].append({"date": f["date"], "size": f["size"]})
    return jsonify({"success": True, "data": files, "grouped": levels})


@log_bp.route("/read", methods=["GET"])
def read_logs():
    source = request.args.get("source", "backend")
    date_str = request.args.get("date", datetime.now(UTC).strftime("%Y-%m-%d"))
    level_filter = request.args.get("level", "").lower()
    limit = min(int(request.args.get("limit", "200")), 2000)
    offset = int(request.args.get("offset", "0"))
    keyword = request.args.get("q", "").lower().strip()

    file_path = get_log_file_path(source, date_str)
    if not file_path.exists():
        return jsonify({"success": True, "data": [], "total": 0, "counts": {}})

    entries = []
    with open(file_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            if level_filter and entry.get("level", "").lower() != level_filter:
                continue
            if keyword:
                text = json.dumps(entry, ensure_ascii=False).lower()
                if keyword not in text:
                    continue

            entries.append(entry)

    total = len(entries)
    counts = {}
    for e in entries:
        lv = e.get("level", "info").lower()
        counts[lv] = counts.get(lv, 0) + 1

    page = entries[offset : offset + limit]
    return jsonify({"success": True, "data": page, "total": total, "counts": counts})


@log_bp.route("/ingest", methods=["POST"])
@limiter.limit("60 per minute")
def ingest_logs():
    body = request.get_json(silent=True)
    if not body or "entries" not in body:
        return jsonify({"success": False, "error": "Missing entries field"}), 400

    entries = body["entries"]
    if not isinstance(entries, list):
        return jsonify({"success": False, "error": "entries must be a list"}), 400

    count = 0
    now = datetime.now(UTC).isoformat()
    for entry in entries:
        if not isinstance(entry, dict) or "level" not in entry or "message" not in entry:
            continue
        if "time" not in entry:
            entry["time"] = now
        append_log_entry("frontend", entry)
        count += 1

    logger.info(f"接收到 {count} 条前端日志")
    return jsonify({"success": True, "count": count})


@log_bp.route("/analyze", methods=["POST"])
def analyze_logs():
    body = request.get_json(silent=True) or {}
    source = body.get("source", "backend")
    date_str = body.get("date", datetime.now(UTC).strftime("%Y-%m-%d"))

    file_path = get_log_file_path(source, date_str)
    if not file_path.exists():
        return jsonify({"success": False, "error": f"日志文件不存在: {source}/{date_str}"}), 404

    try:
        from scripts.analyze_logs import analyze_logs as run_analysis

        result = run_analysis(source, date_str)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        logger.error(f"日志分析失败: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
