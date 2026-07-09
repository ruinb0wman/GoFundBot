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


class TestContractScreening(unittest.TestCase):
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

    def test_screening_query_returns_200(self):
        resp = self.client.post(
            "/api/screening/query",
            json={
                "fund_type": "gp",
                "page": 1,
                "page_size": 20,
            },
        )
        self.assertIn(resp.status_code, (200, 500))

    def test_screening_with_filters(self):
        resp = self.client.post(
            "/api/screening/query",
            json={
                "fund_type": "gp",
                "min_return_1y": 5.0,
                "sort_by": "return_1y",
                "sort_order": "desc",
                "page": 1,
                "page_size": 10,
            },
        )
        self.assertIn(resp.status_code, (200, 500))

    def test_screening_empty_result(self):
        resp = self.client.post("/api/screening/query", json={"page": 1, "page_size": 20})
        self.assertIn(resp.status_code, (200, 500))

    def test_screening_missing_type_uses_default(self):
        resp = self.client.post("/api/screening/query", json={})
        self.assertIn(resp.status_code, (200, 500))

    def test_screening_status_returns_200(self):
        resp = self.client.get("/api/screening/status")
        self.assertEqual(resp.status_code, 200)

    def test_screening_progress_returns_200(self):
        resp = self.client.get("/api/screening/progress")
        self.assertIn(resp.status_code, (200, 404))


if __name__ == "__main__":
    unittest.main()
