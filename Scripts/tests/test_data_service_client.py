import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.data_service_client import ServiceClient, ServiceError


class TestServiceClient(unittest.TestCase):
    def setUp(self):
        self.client = ServiceClient(base_url="http://test:3100/api", timeout=5)

    @patch.object(ServiceClient, "_get")
    def test_health(self, mock_get):
        mock_get.return_value = {"status": "ok"}
        result = self.client.health()
        self.assertEqual(result, {"status": "ok"})

    @patch.object(ServiceClient, "_get")
    def test_get_fund_estimate(self, mock_get):
        mock_get.return_value = {"data": {"fund_code": "000001", "estimate": 1.5}}
        result = self.client.get_fund_estimate("000001")
        mock_get.assert_called_with("/funds/000001/estimate")
        self.assertEqual(result["data"]["estimate"], 1.5)

    @patch.object(ServiceClient, "_get")
    def test_get_fund_estimates(self, mock_get):
        mock_get.return_value = {"data": []}
        self.client.get_fund_estimates(["000001", "000002"])
        mock_get.assert_called_with("/funds/estimates", params={"codes": "000001,000002"})

    @patch.object(ServiceClient, "_get")
    def test_search_funds(self, mock_get):
        mock_get.return_value = {"data": []}
        self.client.search_funds("华夏")
        mock_get.assert_called_with("/funds/search", params={"q": "华夏"})

    @patch.object(ServiceClient, "_get")
    def test_get_fund_basic(self, mock_get):
        mock_get.return_value = {"data": {"fund_code": "000001"}}
        self.client.get_fund_basic("000001")
        mock_get.assert_called_with("/funds/000001/basic")

    @patch.object(ServiceClient, "_get")
    def test_get_fund_detail(self, mock_get):
        mock_get.return_value = {"data": {}}
        self.client.get_fund_detail("000001")
        mock_get.assert_called_once_with("/funds/000001/detail", timeout=20.0)

    def test_get_fund_screening_snapshot_params(self):
        with patch.object(self.client, "_get") as mock_get:
            mock_get.return_value = {"data": {"items": []}}
            self.client.get_fund_screening_snapshot(types=["gp"], page_size=100, sort="1nzf")
            mock_get.assert_called_with(
                "/funds/screening-snapshot", params={"pageSize": "100", "sort": "1nzf", "types": "gp"}, timeout=20.0
            )

    @patch.object(ServiceClient, "_get")
    def test_get_fund_nav_history(self, mock_get):
        mock_get.return_value = {"data": {}}
        self.client.get_fund_nav_history("000001", start_date="2024-01-01")
        mock_get.assert_called_with("/funds/000001/nav-history", params={"startDate": "2024-01-01"})

    @patch.object(ServiceClient, "_get")
    def test_get_fund_rank_history(self, mock_get):
        mock_get.return_value = {"data": {}}
        self.client.get_fund_rank_history("000001")
        mock_get.assert_called_with("/funds/000001/rank-history")

    @patch.object(ServiceClient, "_get")
    def test_get_fund_dividends(self, mock_get):
        mock_get.return_value = {"data": {}}
        self.client.get_fund_dividends("000001")
        mock_get.assert_called_once_with("/funds/000001/dividends", timeout=20.0)

    @patch.object(ServiceClient, "_get")
    def test_get_market_quotes(self, mock_get):
        mock_get.return_value = {"data": []}
        self.client.get_market_quotes(["000001.SZ", "000300.SH"])
        mock_get.assert_called_with("/market/quotes", params={"symbols": "000001.SZ,000300.SH"})

    @patch.object(ServiceClient, "_get")
    def test_get_market_kline(self, mock_get):
        mock_get.return_value = {"data": []}
        self.client.get_market_kline("000001.SZ", period="daily", start_date="2024-01-01")
        mock_get.assert_called_with(
            "/market/kline/000001.SZ", params={"period": "daily", "adjust": "none", "startDate": "2024-01-01"}
        )

    @patch.object(ServiceClient, "_get")
    def test_get_flash_news(self, mock_get):
        mock_get.return_value = {"data": []}
        self.client.get_flash_news(count=10, page=2)
        mock_get.assert_called_with("/news/flash", params={"count": "10", "page": "2"})

    @patch.object(ServiceClient, "_get")
    def test_stock_reference(self, mock_get):
        mock_get.return_value = {"data": {}}
        self.client.get_stock_reference("000001")
        mock_get.assert_called_with("/stocks/000001/reference")

    def test_request_timeout_raises_data_service_error(self):
        with patch.object(self.client.session, "get") as mock_get:
            import requests

            mock_get.side_effect = requests.Timeout("timeout")
            with self.assertRaises(ServiceError) as ctx:
                self.client.health()
            self.assertEqual(ctx.exception.code, "DATA_SERVICE_UNAVAILABLE")
            self.assertEqual(ctx.exception.status_code, 503)

    def test_connection_failure_raises_data_service_error(self):
        with patch.object(self.client.session, "get") as mock_get:
            import requests

            mock_get.side_effect = requests.ConnectionError("connection refused")
            with self.assertRaises(ServiceError) as ctx:
                self.client.health()
            self.assertEqual(ctx.exception.code, "DATA_SERVICE_UNAVAILABLE")

    def test_non_json_response(self):
        with patch.object(self.client.session, "get") as mock_get:
            mock_response = Mock()
            mock_response.json.side_effect = ValueError("not json")
            mock_response.status_code = 200
            mock_get.return_value = mock_response
            with self.assertRaises(ServiceError) as ctx:
                self.client.health()
            self.assertEqual(ctx.exception.status_code, 502)

    def test_success_false_in_response(self):
        with patch.object(self.client.session, "get") as mock_get:
            mock_response = Mock()
            mock_response.json.return_value = {"success": False, "error": {"code": "NOT_FOUND", "message": "not found"}}
            mock_response.status_code = 404
            mock_get.return_value = mock_response
            with self.assertRaises(ServiceError) as ctx:
                self.client.health()
            self.assertEqual(ctx.exception.code, "NOT_FOUND")

    def test_http_4xx_without_success_false(self):
        with patch.object(self.client.session, "get") as mock_get:
            mock_response = Mock()
            mock_response.json.return_value = {"data": {}}
            mock_response.status_code = 404
            mock_get.return_value = mock_response
            with self.assertRaises(ServiceError) as ctx:
                self.client.health()
            self.assertEqual(ctx.exception.status_code, 404)

    def test_url_construction(self):
        self.assertEqual(self.client.base_url, "http://test:3100/api")

    def test_drop_none_filters_none_values(self):
        result = ServiceClient._drop_none({"a": 1, "b": None, "c": "hello"})
        self.assertEqual(result, {"a": 1, "c": "hello"})


if __name__ == "__main__":
    unittest.main()
