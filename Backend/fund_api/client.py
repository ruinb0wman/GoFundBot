import json
import re
from typing import Any

import requests

from core.logging import get_logger
from fund_api.cleaner import FundDataCleaner

logger = get_logger(__name__)


class FundAPI:
    def __init__(self):
        self.headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        self.cleaner = FundDataCleaner()
        self._fund_type_cache = None

    def _load_fund_type_cache(self):
        if self._fund_type_cache is not None:
            return self._fund_type_cache

        try:
            import os

            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            cache_path = os.path.join(base_dir, "Data", "fund_list_cache.json")

            if os.path.exists(cache_path):
                with open(cache_path, encoding="utf-8") as f:
                    data = json.load(f)
                    funds = data.get("funds", [])
                    self._fund_type_cache = {f.get("CODE"): f.get("TYPE") for f in funds if f.get("CODE")}
            else:
                self._fund_type_cache = {}
        except Exception as e:
            logger.error(f"Error loading fund type cache: {e}")
            self._fund_type_cache = {}

        return self._fund_type_cache

    def get_fund_data(self, fund_code: str) -> dict[str, Any] | None:
        raw_data = self._fetch_raw_data(fund_code)
        if not raw_data:
            return None

        fund_type_cache = self._load_fund_type_cache()
        fund_type = fund_type_cache.get(fund_code, "")
        if fund_type:
            raw_data["fund_type_from_cache"] = fund_type

        try:
            return self.cleaner.clean_all_data(raw_data)
        except Exception as e:
            logger.error(f"Error cleaning data for {fund_code}: {e}")
            return None

    def search_funds(self, keyword: str) -> list[dict[str, Any]]:
        url = "https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx"
        params = {"m": 1, "key": keyword}
        try:
            response = requests.get(url, params=params, headers=self.headers, timeout=5)
            if response.status_code == 200:
                data = response.json()
                if "Datas" in data:
                    funds = [item for item in data["Datas"] if item.get("CATEGORYDESC") == "\u57fa\u91d1"]
                    return funds
            return []
        except Exception as e:
            logger.error(f"Search error: {e}")
            return []

    def _parse_js_value(self, js_content: str, start_pos: int) -> tuple:
        pos = start_pos
        while pos < len(js_content) and js_content[pos] in " \t\n\r":
            pos += 1

        if pos >= len(js_content):
            return None, pos

        char = js_content[pos]

        if char == "[":
            depth = 1
            end_pos = pos + 1
            while end_pos < len(js_content) and depth > 0:
                c = js_content[end_pos]
                if c == "[":
                    depth += 1
                elif c == "]":
                    depth -= 1
                elif c == '"' or c == "'":
                    quote = c
                    end_pos += 1
                    while end_pos < len(js_content):
                        if js_content[end_pos] == quote and js_content[end_pos - 1] != "\\":
                            break
                        end_pos += 1
                end_pos += 1
            return js_content[pos:end_pos], end_pos

        elif char == "{":
            depth = 1
            end_pos = pos + 1
            while end_pos < len(js_content) and depth > 0:
                c = js_content[end_pos]
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                elif c == '"' or c == "'":
                    quote = c
                    end_pos += 1
                    while end_pos < len(js_content):
                        if js_content[end_pos] == quote and js_content[end_pos - 1] != "\\":
                            break
                        end_pos += 1
                end_pos += 1
            return js_content[pos:end_pos], end_pos

        elif char == '"' or char == "'":
            quote = char
            end_pos = pos + 1
            while end_pos < len(js_content):
                if js_content[end_pos] == quote and js_content[end_pos - 1] != "\\":
                    end_pos += 1
                    break
                end_pos += 1
            return js_content[pos:end_pos], end_pos

        else:
            end_pos = pos
            while end_pos < len(js_content) and js_content[end_pos] != ";":
                end_pos += 1
            return js_content[pos:end_pos].strip(), end_pos

    def _fetch_raw_data(self, fund_code: str) -> dict[str, Any] | None:
        data = {}

        url = f"https://fund.eastmoney.com/pingzhongdata/{fund_code}.js"
        try:
            response = requests.get(url, headers=self.headers, timeout=10)
            if response.status_code == 200:
                js_content = response.text

                var_pattern = re.compile(r"var\s+(\w+)\s*=\s*")
                for match in var_pattern.finditer(js_content):
                    var_name = match.group(1)
                    value_start = match.end()

                    raw_value, _ = self._parse_js_value(js_content, value_start)

                    if raw_value:
                        try:
                            if raw_value.startswith("[") or raw_value.startswith("{"):
                                json_value = raw_value.replace("'", '"')
                                data[var_name] = json.loads(json_value)
                            elif (
                                raw_value.startswith('"')
                                and raw_value.endswith('"')
                                or raw_value.startswith("'")
                                and raw_value.endswith("'")
                            ):
                                data[var_name] = raw_value[1:-1]
                            else:
                                data[var_name] = raw_value
                        except json.JSONDecodeError:
                            data[var_name] = raw_value

        except Exception as e:
            logger.error(f"Error fetching detail for {fund_code}: {e}")
            return None

        try:
            real_time_url = f"http://fundgz.1234567.com.cn/js/{fund_code}.js"
            response = requests.get(real_time_url, headers=self.headers, timeout=3)
            if response.status_code == 200:
                match = re.search(r"jsonpgz\((.*?)\);", response.text)
                if match:
                    rt_data = json.loads(match.group(1))
                    if rt_data:
                        data.update(rt_data)
        except Exception:
            pass

        if not data:
            return None

        if "fS_code" not in data:
            data["fS_code"] = fund_code

        return data
