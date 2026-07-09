import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from database import Base as DbBase


class TestContractWatchlist(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ds_patcher = patch("services.data_service_client.get_data_service_client")
        cls.mock_get_ds = cls.ds_patcher.start()
        cls.mock_client = MagicMock()
        cls.mock_get_ds.return_value = cls.mock_client

        from database import engine, init_db

        DbBase.metadata.create_all(engine)
        init_db()

    @classmethod
    def tearDownClass(cls):
        from database import engine

        DbBase.metadata.drop_all(engine)
        cls.ds_patcher.stop()

    def setUp(self):
        from database import SessionLocal

        db = SessionLocal()
        for table in reversed(DbBase.metadata.sorted_tables):
            db.execute(table.delete())
        db.commit()
        db.close()

        from app import app

        app.config["TESTING"] = True
        self.client = app.test_client()

    def test_add_and_get_watchlist(self):
        self.mock_client.get_fund_estimate.return_value = {}
        self.mock_client.get_fund_detail.return_value = {}
        resp = self.client.post("/api/watchlist", json={"fund_code": "000001", "fund_name": "Test Fund"})
        self.assertIn(resp.status_code, (201, 200))
        resp2 = self.client.get("/api/watchlist")
        self.assertEqual(resp2.status_code, 200)
        data = resp2.get_json()
        self.assertIn("data", data)

    def test_add_duplicate_fund_returns_409(self):
        self.mock_client.get_fund_estimate.return_value = {}
        self.client.post("/api/watchlist", json={"fund_code": "000001", "fund_name": "Test"})
        resp2 = self.client.post("/api/watchlist", json={"fund_code": "000001", "fund_name": "Test"})
        self.assertEqual(resp2.status_code, 409)

    def test_remove_fund(self):
        self.mock_client.get_fund_estimate.return_value = {}
        self.client.post("/api/watchlist", json={"fund_code": "000001", "fund_name": "Test"})
        resp = self.client.delete("/api/watchlist/000001")
        self.assertIn(resp.status_code, (200, 404))

    def test_watchlist_pagination(self):
        resp = self.client.get("/api/watchlist?page=1&page_size=10")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("page", data)
        self.assertIn("page_size", data)

    def test_create_group(self):
        resp = self.client.post("/api/watchlist/groups", json={"name": "My Group"})
        self.assertIn(resp.status_code, (201, 200))

    def test_remove_nonexistent_fund_returns_404(self):
        resp = self.client.delete("/api/watchlist/999999")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
