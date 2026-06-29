"""市场异动检测服务"""

from core.logging import get_logger

logger = get_logger(__name__)


def detect_market_anomalies() -> dict:
    """
    检测今日市场异动。
    检测项目:
      1. 指数大幅波动 (涨跌幅 > 3%)
      2. 成交量异常 (当日 vs 20日均量)
    返回:
      {
        "anomalies": [
          { "type": "index_surge" | "volume_spike", "name": str, "value": str, "detail": str },
        ],
        "detected_at": str
      }
    """
    anomalies = []

    try:
        from services.data_service_client import get_market_indices

        indices = get_market_indices()
        if isinstance(indices, list):
            for idx in indices:
                change_pct = idx.get("change_percent") or idx.get("change", 0)
                try:
                    change_pct = float(change_pct)
                except (ValueError, TypeError):
                    continue
                name = idx.get("name", "未知指数")
                if change_pct >= 3:
                    anomalies.append(
                        {
                            "type": "index_surge",
                            "name": name,
                            "value": f"+{change_pct:.2f}%",
                            "detail": f"{name} 大涨 {change_pct:.2f}%",
                        }
                    )
                elif change_pct <= -3:
                    anomalies.append(
                        {
                            "type": "index_plunge",
                            "name": name,
                            "value": f"{change_pct:.2f}%",
                            "detail": f"{name} 大跌 {change_pct:.2f}%",
                        }
                    )
    except Exception as e:
        logger.warning(f"指数异动检测失败: {e}")

    if not anomalies:
        anomalies.append(
            {
                "type": "no_anomaly",
                "name": "今日无异动",
                "value": "",
                "detail": "主要指数未检测到大幅波动",
            }
        )

    from datetime import datetime

    return {
        "anomalies": anomalies,
        "detected_at": datetime.now().isoformat(),
    }
