import os


def parse_cors_origins(raw: str | None = None) -> str | list[str]:
    if raw is None:
        raw = os.getenv("CORS_ORIGINS", "")
    raw = raw.strip()
    if not raw or raw == "*":
        return "*"
    return [item.strip() for item in raw.split(",") if item.strip()]
