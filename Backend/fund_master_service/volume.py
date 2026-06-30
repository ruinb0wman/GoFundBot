# -*- coding: UTF-8 -*-
"""
Fund-Master A股成交量模块
"""

import datetime


class FundMasterServiceVolumeMixin:
    """Mixin: 近7日A股成交量"""

    def get_a_volume_7days(self) -> dict:
        """
        获取近7日A股成交量（沪深北三市）
        数据源：百度股市通

        Returns:
            dict: {'success': bool, 'data': list, 'update_time': str}
        """
        cache_key = "a_volume_7days"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        try:
            url = "https://finance.pae.baidu.com/sapi/v1/metrictrend"
            params = {
                "financeType": "index",
                "market": "ab",
                "code": "000001",
                "targetType": "market",
                "metric": "amount",
                "finClientType": "pc",
            }

            response = self.baidu_session.get(url, params=params, timeout=10, verify=False)

            if str(response.json().get("ResultCode")) == "0":
                trend = response.json()["Result"]["trend"]
                result = []

                today = datetime.datetime.now()
                dates = [(today - datetime.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(8)]

                for date in dates:
                    total = trend[0]
                    sh = trend[1]
                    sz = trend[2]
                    bj = trend[3]

                    total_data = [x for x in total["content"] if x["marketDate"] == date]
                    sh_data = [x for x in sh["content"] if x["marketDate"] == date]
                    sz_data = [x for x in sz["content"] if x["marketDate"] == date]
                    bj_data = [x for x in bj["content"] if x["marketDate"] == date]

                    if total_data and sh_data and sz_data and bj_data:
                        result.append(
                            {
                                "date": date,
                                "total": total_data[0]["data"]["amount"] + "亿",
                                "shanghai": sh_data[0]["data"]["amount"] + "亿",
                                "shenzhen": sz_data[0]["data"]["amount"] + "亿",
                                "beijing": bj_data[0]["data"]["amount"] + "亿",
                            }
                        )

                data = {
                    "success": True,
                    "data": result,
                    "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }
                self._set_cache(cache_key, data, "a_volume_7days")
                return data

            return {"success": False, "error": "获取成交量数据失败", "data": []}

        except Exception as e:
            return {"success": False, "error": str(e), "data": []}
