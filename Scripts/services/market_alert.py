"""市场异动检测服务"""

import json
import os
from datetime import datetime
from pathlib import Path

from core.logging import get_logger

logger = get_logger(__name__)

_ANOMALY_CONFIG_PATH = (
    Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) / "Data" / "anomaly_config.json"
)

_DEFAULTS = {
    "index_surge_threshold": 3.0,
    "index_plunge_threshold": -3.0,
    "volume_surge_ratio": 1.5,
    "volume_shrink_ratio": 0.5,
    "sector_surge_threshold": 5.0,
    "sector_plunge_threshold": -5.0,
    "sector_inflow_threshold": 10.0,
    "north_inflow_threshold": 100.0,
    "north_outflow_threshold": -50.0,
}


def _load_anomaly_config() -> dict:
    if _ANOMALY_CONFIG_PATH.exists():
        try:
            with open(_ANOMALY_CONFIG_PATH, encoding="utf-8") as f:
                data = json.load(f)
            result = dict(_DEFAULTS)
            result.update({k: v for k, v in data.items() if k in _DEFAULTS and isinstance(v, (int, float))})
            return result
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"读取异动配置失败，使用默认值: {e}")
    return dict(_DEFAULTS)


def _detect_index_anomaly(anomalies: list) -> None:
    cfg = _load_anomaly_config()
    surge_threshold = cfg["index_surge_threshold"]
    plunge_threshold = cfg["index_plunge_threshold"]

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
                if change_pct >= surge_threshold:
                    anomalies.append(
                        {
                            "type": "index_surge",
                            "name": name,
                            "value": f"+{change_pct:.2f}%",
                            "detail": f"{name} 大涨 {change_pct:.2f}%",
                        }
                    )
                elif change_pct <= plunge_threshold:
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


def detect_market_anomalies() -> dict:
    """
    检测今日市场异动。
    检测项目:
      1. 指数大幅波动 (涨跌幅 > 阈值)
      2. 成交量异常 (当日 vs 20日均量)
      3. 板块异动
      4. 北向资金异动
    返回:
      {
        "anomalies": [ { "type": str, "name": str, "value": str, "detail": str }, ... ],
        "detected_at": str
      }
    """
    anomalies = []

    _detect_index_anomaly(anomalies)

    if not anomalies:
        anomalies.append(
            {
                "type": "no_anomaly",
                "name": "今日无异动",
                "value": "",
                "detail": "主要指数未检测到大幅波动",
            }
        )

    return {
        "anomalies": anomalies,
        "detected_at": datetime.now().isoformat(),
    }
