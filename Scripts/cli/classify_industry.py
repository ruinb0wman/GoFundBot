#!/usr/bin/env python3
"""
Classify funds into industry tags based on fund name.

stdin: {"funds": [{"fund_code":"019667","fund_name":"易方达中证创新药..."}, ...]}
stdout: {"success": true, "data": {"classified": [{"fund_code":"019667","industry_tag":"医药医疗"}, ...]}}
"""
import json
import os
import re
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.dirname(os.path.abspath(__file__)), _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from _template import run_script, read_stdin


INDUSTRY_RULES = [
    (r"创新药|医疗|医药|生物|医美|健康", "医药医疗"),
    (r"新能源|光伏|风电|氢能|锂电|电池|能源", "新能源"),
    (r"半导体|芯片|集成电路|电子", "半导体/芯片"),
    (r"AI|人工智能|智能|机器人|大模型|算力", "人工智能"),
    (r"消费|白酒|食品|饮料|家电|零售", "消费"),
    (r"科技|互联|信息|软件|IT|计算机", "科技"),
    (r"金融|银行|保险|证券|地产", "金融地产"),
    (r"军工|国防|航天|航空", "军工"),
    (r"化工|材料|有色|钢铁|建材", "周期"),
    (r"沪深300|中证\w+|上证\w+|MSCI|指数", "宽基指数"),
    (r"红利|股息", "红利"),
    (r"债券|纯债|短债|信用债|利率债", "固收"),
    (r"货币|理财", "货币"),
    (r"海外|QDII|纳斯达克|恒生|标普|港股|美股", "海外"),
    (r"新能源车|汽车", "新能源汽车"),
    (r"通信|5G|6G|光模块", "通信"),
    (r"碳中和|环保|ESG", "环保/碳中和"),
    (r"黄金|贵金属", "黄金/贵金属"),
]


def classify_fund_name(name):
    if not name:
        return "其他"
    for pattern, tag in INDUSTRY_RULES:
        if re.search(pattern, name):
            return tag
    return "其他"


def main():
    params = read_stdin()
    funds = params.get("funds", [])

    if not funds:
        return {"error": "No funds provided. Pass stdin: {\"funds\": [...]}"}

    classified = []
    for f in funds:
        tag = classify_fund_name(f.get("fund_name", ""))
        classified.append({
            "fund_code": f["fund_code"],
            "fund_name": f.get("fund_name", ""),
            "industry_tag": tag,
        })

    return {"classified": classified, "total": len(classified)}


if __name__ == "__main__":
    run_script(main)
