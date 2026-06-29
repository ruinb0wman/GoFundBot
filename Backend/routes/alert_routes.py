from datetime import datetime

from flask import Blueprint, jsonify, request
from sqlalchemy import desc

from core.logging import get_logger
from core.validation import validate_body
from database import get_request_db as get_db
from models import AlertRule
from schemas.alert_schemas import AlertRuleCreateSchema, AlertRuleUpdateSchema

logger = get_logger(__name__)

alert_bp = Blueprint("alert", __name__, url_prefix="/api/alerts")


@alert_bp.route("", methods=["GET"])
def list_alerts():
    """列出所有告警规则"""
    db = get_db()
    rules = db.query(AlertRule).order_by(desc(AlertRule.created_time)).all()
    return jsonify(
        [
            {
                "id": r.id,
                "fund_code": r.fund_code,
                "alert_type": r.alert_type,
                "threshold": r.threshold,
                "enabled": bool(r.enabled),
                "last_triggered": r.last_triggered.isoformat() if r.last_triggered else None,
                "created_time": r.created_time.isoformat(),
            }
            for r in rules
        ]
    )


@alert_bp.route("", methods=["POST"])
@validate_body(AlertRuleCreateSchema)
def create_alert():
    """创建告警规则"""
    data = request.get_json()
    db = get_db()
    existing = (
        db.query(AlertRule)
        .filter(
            AlertRule.fund_code == data["fund_code"],
            AlertRule.alert_type == data["alert_type"],
        )
        .first()
    )
    if existing:
        existing.threshold = data["threshold"]
        existing.enabled = 1
        existing.updated_time = datetime.now()
    else:
        rule = AlertRule(
            fund_code=data["fund_code"],
            alert_type=data["alert_type"],
            threshold=data["threshold"],
        )
        db.add(rule)
    db.commit()
    return jsonify({"status": "ok"}), 201


@alert_bp.route("/<int:rule_id>", methods=["PUT"])
@validate_body(AlertRuleUpdateSchema)
def update_alert(rule_id):
    """更新告警规则"""
    data = request.get_json()
    db = get_db()
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        return jsonify({"error": "告警规则不存在"}), 404

    if "threshold" in data and data["threshold"] is not None:
        rule.threshold = data["threshold"]
    if "enabled" in data and data["enabled"] is not None:
        rule.enabled = data["enabled"]
    rule.updated_time = datetime.now()
    db.commit()
    return jsonify({"status": "ok"})


@alert_bp.route("/<int:rule_id>", methods=["DELETE"])
def delete_alert(rule_id):
    """删除告警规则"""
    db = get_db()
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        return jsonify({"error": "告警规则不存在"}), 404
    db.delete(rule)
    db.commit()
    return jsonify({"status": "ok"})


@alert_bp.route("/check", methods=["GET"])
def check_alerts():
    """检查所有启用的告警规则是否触发"""
    db = get_db()
    rules = db.query(AlertRule).filter(AlertRule.enabled == 1).all()
    triggered = []
    for rule in rules:
        try:
            from services.data_service_client import get_fund_estimate

            estimate = get_fund_estimate(rule.fund_code)
            if not estimate:
                continue

            current_change = estimate.get("estimate_change")
            if current_change is None:
                continue

            current_change = abs(float(current_change))

            if (
                rule.alert_type in ("price_up", "return_above")
                and current_change >= rule.threshold
                or rule.alert_type in ("price_down", "return_below")
                and current_change >= rule.threshold
            ):
                triggered.append(
                    {
                        "id": rule.id,
                        "fund_code": rule.fund_code,
                        "alert_type": rule.alert_type,
                        "threshold": rule.threshold,
                        "current_value": current_change,
                    }
                )
                rule.last_triggered = datetime.now()
        except Exception as e:
            logger.warning(f"检查告警规则 {rule.id} 失败: {e}")
            continue

    if triggered:
        db.commit()

    return jsonify({"triggered": triggered, "checked_count": len(rules)})


@alert_bp.route("/market-anomaly", methods=["GET"])
def market_anomaly():
    """获取今日市场异动"""
    try:
        from services.market_alert import detect_market_anomalies

        anomalies = detect_market_anomalies()
        return jsonify(anomalies)
    except Exception as e:
        logger.error(f"市场异动检测失败: {e}")
        return jsonify({"error": "检测失败", "anomalies": []})
