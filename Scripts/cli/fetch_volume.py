#!/usr/bin/env python3
"""
Fetch A-share 7-day volume data.
stdout: {"success": true, "data": [{"date":"...","total":"...","shanghai":"...","shenzhen":"...","beijing":"..."}]}
"""
from _template import run_script
from fund_master_service import get_fund_master_service


def main() -> list:
    srv = get_fund_master_service()
    result = srv.get_a_volume_7days()
    if result.get("success"):
        return result["data"]
    raise RuntimeError(result.get("error", "获取成交量数据失败"))


if __name__ == "__main__":
    run_script(main)
