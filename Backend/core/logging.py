import json
import logging
import os
import sys
from datetime import UTC, datetime
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path


class JsonFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            "time": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "func": record.funcName,
            "line": record.lineno,
        }
        if hasattr(record, "source"):
            payload["source"] = record.source
        return json.dumps(payload, ensure_ascii=False)


def _log_dir() -> Path:
    custom = os.getenv("LOG_DIR", "").strip()
    if custom:
        return Path(custom)
    return Path(__file__).resolve().parent.parent / "Data" / "logs"


def _retention_days() -> int:
    return int(os.getenv("LOG_RETENTION_DAYS", "30"))


def init_logging(level=logging.INFO):
    root = logging.getLogger()
    root.handlers.clear()

    formatter = JsonFormatter()
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    root.addHandler(stream_handler)

    log_path = _log_dir()
    log_path.mkdir(parents=True, exist_ok=True)
    file_handler = TimedRotatingFileHandler(
        filename=str(log_path / "backend.log"),
        when="midnight",
        interval=1,
        backupCount=_retention_days(),
        encoding="utf-8",
    )
    file_handler.suffix = "%Y-%m-%d.jsonl"
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    root.setLevel(level)


def get_log_file_path(source: str, date_str: str) -> Path:
    return _log_dir() / f"{source}-{date_str}.jsonl"


def list_log_files() -> list[dict]:
    log_dir = _log_dir()
    if not log_dir.exists():
        return []
    files = []
    for f in sorted(log_dir.iterdir()):
        if not f.is_file() or f.suffix != ".jsonl":
            continue
        name = f.stem
        if "-" in name:
            source, date_str = name.split("-", 1)
            files.append({"source": source, "date": date_str, "size": f.stat().st_size, "path": str(f)})
    return files


def append_log_entry(source: str, entry: dict) -> None:
    log_dir = _log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    file_path = get_log_file_path(source, today)
    entry["source"] = source
    line = json.dumps(entry, ensure_ascii=False) + "\n"
    with open(file_path, "a", encoding="utf-8") as f:
        f.write(line)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
