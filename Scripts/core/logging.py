import json
import logging
import os
import sys
from datetime import UTC, datetime
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
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _log_dir() -> Path:
    custom = os.getenv("LOG_DIR", "").strip()
    if custom:
        return Path(custom)
    return Path(__file__).resolve().parent.parent / "Data" / "logs"


def _retention_days() -> int:
    return int(os.getenv("LOG_RETENTION_DAYS", "30"))


class DailyJsonlFileHandler(logging.Handler):
    """每天生成一个 {name}-YYYY-MM-DD.jsonl 文件的 Handler。"""

    def __init__(self, name: str, log_dir: Path | None = None):
        super().__init__()
        self.name = name
        self.log_dir = log_dir or _log_dir()
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._current_date = ""
        self._file = None
        self._open_file()

    def _file_path(self) -> Path:
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        return self.log_dir / f"{self.name}-{today}.jsonl"

    def _open_file(self):
        if self._file:
            self._file.close()
        self._current_date = datetime.now(UTC).strftime("%Y-%m-%d")
        self._file = open(self._file_path(), "a", encoding="utf-8")

    def emit(self, record):
        if datetime.now(UTC).strftime("%Y-%m-%d") != self._current_date:
            self._open_file()
        try:
            self._file.write(self.format(record) + "\n")
            self._file.flush()
        except Exception:
            self.handleError(record)

    def close(self):
        if self._file:
            self._file.close()
            self._file = None
        super().close()


def _cleanup_old_logs(log_dir: Path, retention_days: int):
    """清理超过保留期的旧日志文件。"""
    if not log_dir.exists():
        return
    cutoff = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        from datetime import timedelta

        cutoff -= timedelta(days=retention_days)
    except Exception:
        return
    for f in log_dir.iterdir():
        if not f.is_file() or f.suffix != ".jsonl":
            continue
        try:
            mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=UTC)
            if mtime < cutoff:
                f.unlink()
        except Exception:
            pass


def init_logging(level=logging.INFO):
    root = logging.getLogger()
    root.handlers.clear()

    formatter = JsonFormatter()
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    root.addHandler(stream_handler)

    log_dir = _log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    file_handler = DailyJsonlFileHandler("backend", log_dir)
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    _cleanup_old_logs(log_dir, _retention_days())
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
        # 期望格式: {source}-YYYY-MM-DD
        if "-" not in name:
            continue
        source, date_str = name.split("-", 1)
        # 校验 date 部分是否像 YYYY-MM-DD
        if len(date_str) != 10 or date_str[4] != "-" or date_str[7] != "-":
            continue
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
