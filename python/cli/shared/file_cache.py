import functools
import hashlib
import json
import os
import time

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "Data", "cache")


def _ensure_cache_dir():
    os.makedirs(CACHE_DIR, exist_ok=True)


def file_cache(key: str = "", ttl_hours: int = 24):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            _ensure_cache_dir()
            cache_key = (
                key
                or f"{func.__name__}:{hashlib.md5(json.dumps({'args': args, 'kwargs': kwargs}, sort_keys=True, default=str).encode()).hexdigest()}"
            )
            cache_path = os.path.join(CACHE_DIR, f"{cache_key.replace('/', '_')}.json")

            if os.path.exists(cache_path):
                mtime = os.path.getmtime(cache_path)
                age_hours = (time.time() - mtime) / 3600
                if age_hours < ttl_hours:
                    with open(cache_path, encoding="utf-8") as f:
                        return json.load(f)

            result = func(*args, **kwargs)

            _ensure_cache_dir()
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, default=str)

            return result

        return wrapper

    return decorator
