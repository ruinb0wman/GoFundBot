import sys
import unittest
from pathlib import Path

from flask import Flask

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.cache_headers import apply_cache_headers


class TestCacheHeaders(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

        @self.app.route("/static/<path:filename>")
        def static_file(filename):
            return "ok"

        @self.app.route("/api/market/overview")
        def market_overview():
            return "ok"

        @self.app.route("/api/fund/000001")
        def fund_detail():
            return "ok"

        @self.app.route("/api/v1/fund/000001")
        def fund_detail_v1():
            return "ok"

        @self.app.route("/api/watchlist")
        def watchlist():
            return "ok"

        @self.app.route("/api/screening/funds")
        def screening():
            return "ok"

        @self.app.route("/api/unmatched")
        def unmatched():
            return "ok"

        self.app.after_request(apply_cache_headers)
        self.client = self.app.test_client()

    def test_static_file_cache(self):
        resp = self.client.get("/static/js/app.js")
        self.assertEqual(resp.headers.get("Cache-Control"), "public, max-age=31536000, immutable")

    def test_market_cache(self):
        resp = self.client.get("/api/market/overview")
        self.assertEqual(resp.headers.get("Cache-Control"), "public, max-age=30")

    def test_fund_cache(self):
        resp = self.client.get("/api/fund/000001")
        self.assertEqual(resp.headers.get("Cache-Control"), "private, max-age=60")

    def test_fund_v1_cache(self):
        resp = self.client.get("/api/v1/fund/000001")
        self.assertEqual(resp.headers.get("Cache-Control"), "private, max-age=60")

    def test_watchlist_no_cache(self):
        resp = self.client.get("/api/watchlist")
        self.assertEqual(resp.headers.get("Cache-Control"), "private, max-age=0, no-store")

    def test_screening_cache(self):
        resp = self.client.get("/api/screening/funds")
        self.assertEqual(resp.headers.get("Cache-Control"), "private, max-age=60")

    def test_unmatched_path_no_cache_header(self):
        resp = self.client.get("/api/unmatched")
        self.assertIsNone(resp.headers.get("Cache-Control"))

    def test_post_request_no_cache(self):
        resp = self.client.post("/api/fund/000001", data={})
        self.assertIsNone(resp.headers.get("Cache-Control"))


if __name__ == "__main__":
    unittest.main()
