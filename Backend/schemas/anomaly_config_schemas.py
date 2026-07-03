"""市场异动阈值配置模型"""

from pydantic import BaseModel, Field

DEFAULTS = {
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


class AnomalyConfigSchema(BaseModel):
    index_surge_threshold: float = Field(default=3.0, gt=0, le=20)
    index_plunge_threshold: float = Field(default=-3.0, ge=-20, lt=0)
    volume_surge_ratio: float = Field(default=1.5, gt=1.0, le=10)
    volume_shrink_ratio: float = Field(default=0.5, gt=0, lt=1.0)
    sector_surge_threshold: float = Field(default=5.0, gt=0, le=20)
    sector_plunge_threshold: float = Field(default=-5.0, ge=-20, lt=0)
    sector_inflow_threshold: float = Field(default=10.0, ge=0, le=1000)
    north_inflow_threshold: float = Field(default=100.0, ge=0, le=500)
    north_outflow_threshold: float = Field(default=-50.0, ge=-500, lt=0)
