"""
MyBot 配置管理模块
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from dotenv import load_dotenv


class ConfigValidationError(Exception):
    """配置校验失败"""

    pass


@dataclass
class Config:
    """系统配置类 - 单例模式"""

    # === AI 分析配置（当前主用：通过 ai_service.py 读取） ===
    llm_api_key: str | None = None
    llm_api_base: str = "https://api.siliconflow.cn/v1"
    llm_model: str = "Qwen/Qwen2.5-7B-Instruct"

    # === Gemini / OpenAI 备选配置 ===
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3-flash-preview"
    gemini_model_fallback: str = "gemini-2.5-flash"
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model: str = "gpt-4o-mini"
    gemini_request_delay: float = 2.0
    gemini_max_retries: int = 3
    gemini_retry_delay: float = 2.0

    # === 搜索引擎配置 ===
    tavily_api_keys: list[str] = field(default_factory=list)
    serpapi_keys: list[str] = field(default_factory=list)
    bocha_api_keys: list[str] = field(default_factory=list)

    # === 服务连接配置 ===
    data_service_base_url: str = "http://localhost:3100/api"
    data_service_timeout: int = 5

    # 单例实例存储
    _instance: Optional["Config"] = None

    @classmethod
    def get_instance(cls) -> "Config":
        if cls._instance is None:
            cls._instance = cls._load_from_env()
        return cls._instance

    @classmethod
    def _load_from_env(cls) -> "Config":
        env_path = Path(__file__).parent / ".env"
        if not env_path.exists():
            env_path = Path(__file__).parent.parent / ".env"
        load_dotenv(dotenv_path=env_path)

        tavily_keys_str = os.getenv("TAVILY_API_KEYS", "")
        if not tavily_keys_str:
            tavily_keys_str = os.getenv("TAVILY_API_KEY", "")
        tavily_api_keys = [k.strip() for k in tavily_keys_str.split(",") if k.strip()]

        serpapi_keys_str = os.getenv("SERPAPI_API_KEYS", "")
        if not serpapi_keys_str:
            serpapi_keys_str = os.getenv("SERPAPI_API_KEY", "")
        serpapi_keys = [k.strip() for k in serpapi_keys_str.split(",") if k.strip()]

        bocha_keys_str = os.getenv("BOCHA_API_KEYS", "")
        if not bocha_keys_str:
            bocha_keys_str = os.getenv("BOCHA_API_KEY", "")
        bocha_api_keys = [k.strip() for k in bocha_keys_str.split(",") if k.strip()]

        return cls(
            llm_api_key=os.getenv("LLM_API_KEY"),
            llm_api_base=os.getenv("LLM_API_BASE", "https://api.siliconflow.cn/v1"),
            llm_model=os.getenv("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct"),
            gemini_api_key=os.getenv("GEMINI_API_KEY"),
            gemini_model=os.getenv("GEMINI_MODEL", "gemini-3-flash-preview"),
            gemini_model_fallback=os.getenv("GEMINI_MODEL_FALLBACK", "gemini-2.5-flash"),
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            openai_base_url=os.getenv("OPENAI_BASE_URL"),
            openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            gemini_request_delay=float(os.getenv("GEMINI_REQUEST_DELAY", "2.0")),
            gemini_max_retries=int(os.getenv("GEMINI_MAX_RETRIES", "3")),
            gemini_retry_delay=float(os.getenv("GEMINI_RETRY_DELAY", "2.0")),
            tavily_api_keys=tavily_api_keys,
            serpapi_keys=serpapi_keys,
            bocha_api_keys=bocha_api_keys,
            data_service_base_url=os.getenv("DATA_SERVICE_BASE_URL", "http://localhost:3100/api"),
            data_service_timeout=int(os.getenv("DATA_SERVICE_TIMEOUT", "5")),
        )

    def validate(self) -> None:
        errors: list[str] = []

        if not self.llm_api_key:
            errors.append("LLM_API_KEY 未设置 — AI 分析功能将不可用")
        elif not self.llm_api_key.startswith("sk-"):
            errors.append("LLM_API_KEY 格式异常（应以 sk- 开头）")

        ds_url = self.data_service_base_url
        parsed = urlparse(ds_url)
        if not parsed.scheme or not parsed.netloc:
            errors.append(f"DATA_SERVICE_BASE_URL 不是合法 URL: {ds_url}")

        if self.data_service_timeout < 1 or self.data_service_timeout > 60:
            errors.append(f"DATA_SERVICE_TIMEOUT 应在 1-60 之间: {self.data_service_timeout}")

        if errors:
            raise ConfigValidationError("\n".join(errors))


def get_config() -> Config:
    return Config.get_instance()
