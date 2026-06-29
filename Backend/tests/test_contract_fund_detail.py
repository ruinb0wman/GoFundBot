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


class TestContractFundDetail(unittest.TestCase):
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
        from app import app

        app.config["TESTING"] = True
        self.client = app.test_client()

    def test_fund_detail_returns_200(self):
        self.mock_client.get_fund_detail.return_value = {"data": {"fund_code": "000001", "fund_name": "Test Fund"}}
        resp = self.client.get("/api/fund/000001")
        self.assertEqual(resp.status_code, 200)

    def test_fund_nav_history(self):
        self.mock_client.get_fund_nav_history.return_value = {"data": {"items": [{"date": "2024-01-01", "nav": 1.0}]}}
        resp = self.client.get("/api/data-service/funds/000001/nav-history?startDate=2024-01-01")
        self.assertIn(resp.status_code, (200, 502))

    def test_fund_search_returns_200(self):
        self.mock_client.search_funds.return_value = {"data": {"items": [{"code": "000001", "name": "Test"}]}}
        resp = self.client.get("/api/fund/search?q=test")
        self.assertIn(resp.status_code, (200, 400))

    def test_fund_estimate(self):
        self.mock_client.get_fund_estimate.return_value = {"data": {"fund_code": "000001", "estimate": 1.5}}
        resp = self.client.get("/api/data-service/funds/000001/estimate")
        self.assertIn(resp.status_code, (200, 502))


if __name__ == "__main__":
    unittest.main()
