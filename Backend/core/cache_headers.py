from flask import request

CACHE_RULES = [
    ("/static/", "public, max-age=31536000, immutable"),
    ("/api/market/", "public, max-age=30"),
    ("/api/fund/", "private, max-age=60"),
    ("/api/v1/fund/", "private, max-age=60"),
    ("/api/watchlist", "private, max-age=0, no-store"),
    ("/api/screening/", "private, max-age=60"),
]


def apply_cache_headers(response):
    if request.method != "GET":
        return response
    path = request.path
    for prefix, header_value in CACHE_RULES:
        if path.startswith(prefix):
            response.headers["Cache-Control"] = header_value
            break
    return response
