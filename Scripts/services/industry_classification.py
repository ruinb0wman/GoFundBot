from services.stock_utils import (
    _detect_market_from_code,
    _fund_name_or_type_text,
    _is_hk_holding_item,
    _is_us_stock_code,
    _portfolio_holding_items,
    _safe_ratio,
)

FUND_TYPE_RULES = [
    ("货币型", ["货币", "现金", "货币市场"]),
    ("债券型", ["债券", "纯债", "短债", "中短债", "可转债", "债券指数"]),
]

BROAD_INDEX_KEYWORDS = [
    "沪深300",
    "中证500",
    "中证800",
    "中证1000",
    "中证2000",
    "上证50",
    "上证180",
    "深证100",
    "创业板指",
    "创业板50",
    "科创50",
    "科创100",
    "A500",
    "MSCI中国A50",
    "央企50",
    "宽基",
    "综合指数",
    "综指",
    "CSI 300",
    "CSI300",
    "CSI 500",
    "CSI500",
    "SSE 50",
]

ETF_FEEDER_KEYWORDS = [
    "ETF联接",
    "ETF连接",
    "ETF链接",
    "联接基金",
    "联接A",
    "联接C",
    "ETF FEEDER",
]

MARKET_TOPIC_RULES = [
    ("美股科技", ["纳斯达克", "NASDAQ", "纳指"]),
    ("美股", ["标普", "S&P", "SP500", "S&P500", "道琼斯", "DOW JONES", "美国", "美股"]),
    ("港股科技", ["恒生科技", "港股科技"]),
    ("港股", ["恒生", "港股", "香港", "HANG SENG", "国企指数"]),
    ("全球市场", ["全球", "海外", "中国海外", "全球精选", "全球配置", "环球"]),
    ("印度市场", ["印度", "INDIA"]),
    ("越南市场", ["越南", "VIETNAM"]),
    ("日本市场", ["日本", "日经", "NIKKEI"]),
    ("德国市场", ["德国", "DAX"]),
    ("法国市场", ["法国", "CAC", "CAC40"]),
    ("英国市场", ["英国", "富时", "FTSE"]),
    ("韩国市场", ["韩国", "KOSPI"]),
    ("东南亚市场", ["东南亚", "东盟", "ASEAN"]),
    ("新兴市场", ["新兴市场", "新兴经济体"]),
]

TOPIC_RULES = [
    ("半导体", ["半导体", "芯片", "集成电路", "CHIP", "SEMICONDUCTOR", "光模块", "光芯片", "CPO", "先进封装"]),
    ("证券", ["证券", "券商", "证券公司", "证券保险"]),
    ("银行", ["银行", "BANK"]),
    ("保险", ["保险"]),
    ("医药", ["医药", "医疗", "生物医药", "创新药", "医疗器械", "HEALTH", "PHARMA", "中药", "制药"]),
    ("消费", ["消费", "食品饮料", "主要消费", "可选消费", "酒", "白酒", "家电", "零售", "电商"]),
    ("新能源", ["新能源", "新能源汽车", "新能源车", "光伏", "太阳能", "储能", "电池", "锂电", "风电", "碳中和"]),
    ("军工", ["军工", "国防", "航天", "航空", "军舰", "武器装备"]),
    ("人工智能", ["人工智能", "AI", "机器人", "智能", "算力", "大模型", "自动驾驶"]),
    ("计算机", ["计算机", "软件", "云计算", "大数据", "互联网", "SAAS", "信创", "数字经济"]),
    ("通信", ["通信", "5G", "通讯", "6G", "卫星通信", "光通信"]),
    ("电子", ["电子", "消费电子", "元件", "PCB"]),
    ("传媒", ["传媒", "游戏", "动漫", "影视", "短视频"]),
    ("房地产", ["房地产", "地产"]),
    ("黄金", ["黄金", "贵金属", "GOLD"]),
    ("有色金属", ["有色", "有色金属", "稀土", "矿业", "矿产"]),
    ("煤炭", ["煤炭"]),
    ("钢铁", ["钢铁"]),
    ("化工", ["化工", "化学", "新材料", "高分子", "聚氨酯"]),
    ("农业", ["农业", "农牧", "畜牧", "养殖", "种业", "渔业"]),
    ("汽车", ["汽车", "整车", "零部件", "汽车电子"]),
    ("电力", ["电力", "发电", "电网", "水电", "核电", "特高压"]),
    ("交通运输", ["交通运输", "物流", "航运", "港口", "铁路"]),
    ("环保", ["环保", "节能", "环境", "水处理"]),
    ("建筑", ["建筑", "基建", "工程", "建材"]),
    ("红利", ["红利", "股息", "高息", "高分红"]),
    ("量化", ["量化", "多因子", "对冲", "绝对收益"]),
    ("灵活配置", ["灵活配置", "灵活策略", "弹性配置"]),
    ("行业轮动", ["行业轮动", "主题轮动", "景气轮动"]),
]

SHENWAN_SECTOR_MAP = {
    "半导体": "电子",
    "元件": "电子",
    "电子": "电子",
    "消费电子": "电子",
    "光学光电子": "电子",
    "PCB": "电子",
    "集成电路": "电子",
    "芯片": "电子",
    "计算机": "计算机",
    "软件": "计算机",
    "IT服务": "计算机",
    "通信设备": "计算机",
    "计算机设备": "计算机",
    "云计算": "计算机",
    "大数据": "计算机",
    "通信": "通信",
    "通讯": "通信",
    "电信": "通信",
    "5G": "通信",
    "通信服务": "通信",
    "电信运营商": "通信",
    "医药": "医药生物",
    "医药生物": "医药生物",
    "药品及科技": "医药生物",
    "化学制药": "医药生物",
    "中药": "医药生物",
    "创新药": "医药生物",
    "医疗器械": "医药生物",
    "医疗": "医药生物",
    "生物医药": "医药生物",
    "医疗服务": "医药生物",
    "医药商业": "医药生物",
    "生物制品": "医药生物",
    "电力设备": "电力设备",
    "新能源": "电力设备",
    "光伏": "电力设备",
    "风电": "电力设备",
    "储能": "电力设备",
    "电池": "电力设备",
    "电网": "电力设备",
    "特高压": "电力设备",
    "机械设备": "机械设备",
    "机械": "机械设备",
    "专用设备": "机械设备",
    "通用设备": "机械设备",
    "自动化设备": "机械设备",
    "仪器仪表": "机械设备",
    "工程机械": "机械设备",
    "机器人": "机械设备",
    "汽车": "汽车",
    "汽车零部件": "汽车",
    "整车": "汽车",
    "汽车电子": "汽车",
    "摩托车": "汽车",
    "军工": "国防军工",
    "国防": "国防军工",
    "航天": "国防军工",
    "航空": "国防军工",
    "武器装备": "国防军工",
    "航海装备": "国防军工",
    "食品饮料": "食品饮料",
    "食品": "食品饮料",
    "白酒": "食品饮料",
    "饮料": "食品饮料",
    "调味品": "食品饮料",
    "乳制品": "食品饮料",
    "银行": "银行",
    "证券": "非银金融",
    "保险": "非银金融",
    "券商": "非银金融",
    "多元金融": "非银金融",
    "金融科技": "非银金融",
    "有色金属": "有色金属",
    "有色": "有色金属",
    "黄金": "有色金属",
    "贵金属": "有色金属",
    "稀土": "有色金属",
    "矿业": "有色金属",
    "化工": "基础化工",
    "化学": "基础化工",
    "化学制品": "基础化工",
    "化学原料": "基础化工",
    "农药": "基础化工",
    "塑料": "基础化工",
    "橡胶": "基础化工",
    "新材料": "基础化工",
    "房地产": "房地产",
    "地产": "房地产",
    "房地产开发": "房地产",
    "建筑": "建筑装饰",
    "建材": "建筑装饰",
    "建筑装饰": "建筑装饰",
    "基建": "建筑装饰",
    "工程": "建筑装饰",
    "装修": "建筑装饰",
    "交通运输": "交通运输",
    "物流": "交通运输",
    "航运": "交通运输",
    "港口": "交通运输",
    "铁路": "交通运输",
    "航空运输": "交通运输",
    "电力": "公用事业",
    "发电": "公用事业",
    "水电": "公用事业",
    "核电": "公用事业",
    "环保": "公用事业",
    "燃气": "公用事业",
    "传媒": "传媒",
    "游戏": "传媒",
    "广告": "传媒",
    "影视": "传媒",
    "出版": "传媒",
    "互联网媒体": "传媒",
    "农业": "农林牧渔",
    "农牧": "农林牧渔",
    "畜牧": "农林牧渔",
    "养殖": "农林牧渔",
    "种业": "农林牧渔",
    "渔业": "农林牧渔",
    "饲料": "农林牧渔",
    "种植": "农林牧渔",
    "家电": "家用电器",
    "家用电器": "家用电器",
    "白色家电": "家用电器",
    "黑色家电": "家用电器",
    "厨电": "家用电器",
    "纺织": "纺织服饰",
    "服装": "纺织服饰",
    "家纺": "纺织服饰",
    "饰品": "纺织服饰",
    "鞋帽": "纺织服饰",
    "轻工": "轻工制造",
    "造纸": "轻工制造",
    "包装": "轻工制造",
    "家具": "轻工制造",
    "文娱用品": "轻工制造",
    "零售": "商贸零售",
    "商贸": "商贸零售",
    "电商": "商贸零售",
    "贸易": "商贸零售",
    "百货": "商贸零售",
    "旅游": "社会服务",
    "酒店": "社会服务",
    "餐饮": "社会服务",
    "教育": "社会服务",
    "会展": "社会服务",
    "煤炭": "煤炭",
    "煤": "煤炭",
    "石油": "石油石化",
    "石化": "石油石化",
    "油气": "石油石化",
    "钢铁": "钢铁",
    "冶钢": "钢铁",
    "综合": "综合",
    "美容": "美容护理",
    "护理": "美容护理",
    "环境": "公用事业",
    "水处理": "公用事业",
}


def _match_keyword_rule(text, rules):
    text = str(text or "").upper()
    for topic, keywords in rules:
        for keyword in keywords:
            if keyword.upper() in text:
                return topic, keyword
    return None, None


def _is_broad_index_fund_text(text):
    text = str(text or "").upper()
    return any(keyword.upper() in text for keyword in BROAD_INDEX_KEYWORDS)


def _is_etf_feeder_text(text):
    text = str(text or "").upper()
    return any(keyword.upper() in text for keyword in ETF_FEEDER_KEYWORDS)


def _topic_from_fund_text(text):
    topic, _ = _match_keyword_rule(text, TOPIC_RULES)
    return topic


def _fund_text_industry_fallback(text):
    text = str(text or "")
    fund_type, type_keyword = _match_keyword_rule(text, FUND_TYPE_RULES)
    if fund_type:
        return {
            "name": fund_type,
            "ratio": 0.0,
            "count": 0,
            "basis": "fund_type",
            "source": "fund_name_rule",
            "matched_keyword": type_keyword,
        }

    market_topic, market_keyword = _match_keyword_rule(text, MARKET_TOPIC_RULES)
    if market_topic:
        return {
            "name": market_topic,
            "ratio": 0.0,
            "count": 0,
            "basis": "market_region",
            "source": "fund_name_rule",
            "matched_keyword": market_keyword,
        }

    if _is_broad_index_fund_text(text):
        return {"name": "宽基指数", "ratio": 0.0, "count": 0, "basis": "broad_index_name", "source": "fund_name_rule"}

    topic, topic_keyword = _match_keyword_rule(text, TOPIC_RULES)
    if topic:
        return {
            "name": topic,
            "ratio": 0.0,
            "count": 0,
            "basis": "index_topic" if ("指数" in text or "ETF" in text.upper()) else "fund_name_topic",
            "source": "fund_name_rule",
            "matched_keyword": topic_keyword,
        }

    if _is_etf_feeder_text(text):
        return {"name": "指数联接", "ratio": 0.0, "count": 0, "basis": "index_topic", "source": "fund_name_rule"}
    return None


def _build_portfolio_industry_tag(portfolio: dict):
    if not isinstance(portfolio, dict):
        return None

    fund_text = _fund_name_or_type_text(portfolio)
    fallback_tag = _fund_text_industry_fallback(fund_text)
    holdings = _portfolio_holding_items(portfolio.get("stock_codes_new")) or _portfolio_holding_items(
        portfolio.get("stock_codes")
    )

    if not holdings:
        return fallback_tag or {
            "name": "混合型",
            "ratio": 0.0,
            "count": 0,
            "basis": "mixed",
            "source": "top_stock_holdings",
            "reason": "missing_holdings",
        }

    buckets = {}
    total_ratio = 0.0
    total_ratio_count = 0
    for item in holdings:
        industry = (
            item.get("industry")
            or item.get("industry_name")
            or item.get("industryName")
            or item.get("sector")
            or item.get("sector_name")
        )
        if not industry and _is_us_stock_code(item.get("code")):
            item_industry = item.get("industry") or item.get("industry_name")
            if item_industry and item_industry not in ("美股",):
                industry = item_industry
            else:
                hint = _detect_market_from_code(item.get("code") or "")
                industry = hint[0] if hint else "海外"
        if not industry and _is_hk_holding_item(item):
            industry = "港股"
        if not industry:
            continue

        ratio = _safe_ratio(item.get("ratio"))
        ratio_available = bool(item.get("ratio_available")) and ratio > 0
        if ratio_available:
            total_ratio += ratio
            total_ratio_count += 1
        bucket = buckets.setdefault(
            industry,
            {
                "name": industry,
                "ratio": 0.0,
                "ratio_count": 0,
                "count": 0,
                "stocks": [],
            },
        )
        if ratio_available:
            bucket["ratio"] += ratio
            bucket["ratio_count"] += 1
        bucket["count"] += 1
        bucket["stocks"].append(
            {
                "code": item.get("code"),
                "name": item.get("name"),
                "ratio": ratio if ratio_available else None,
            }
        )

    if not buckets:
        return fallback_tag or {
            "name": "混合型",
            "ratio": 0.0,
            "count": 0,
            "basis": "mixed",
            "source": "top_stock_holdings",
            "reason": "unresolved_holdings",
        }

    top = sorted(buckets.values(), key=lambda x: (x["count"], x["ratio"]), reverse=True)[0]
    top_by_ratio = sorted(buckets.values(), key=lambda x: (x["ratio"], x["count"]), reverse=True)[0]

    valid_count = sum(x["count"] for x in buckets.values())
    top_share = (top_by_ratio["ratio"] / total_ratio * 100) if total_ratio > 0 else 0.0
    count_share = top["count"] / valid_count * 100 if valid_count else 0.0
    market_dominant = (
        top["name"] in ("美股", "港股", "海外", "印度", "日本", "德国", "法国", "英国", "越南", "韩国")
        and top["count"] >= 3
    )

    result_name = top["name"]
    if result_name == "海外" and fallback_tag and fallback_tag.get("basis") == "market_region":
        result_name = fallback_tag["name"]

    if top["count"] >= 4 or market_dominant:
        return {
            "name": result_name,
            "ratio": round(top["ratio"], 2),
            "count": top["count"],
            "basis": "market_region"
            if top["name"] in ("美股", "港股", "海外", "印度", "日本", "德国", "法国", "英国", "越南", "韩国")
            else "holding_count",
            "source": "top_stock_holdings",
            "top_share": round(top_share, 2),
            "count_share": round(count_share, 2),
            "valid_count": valid_count,
            "has_weight": total_ratio_count > 0,
        }

    if total_ratio > 0 and (top_by_ratio["ratio"] / total_ratio * 100) >= 35:
        return {
            "name": top_by_ratio["name"],
            "ratio": round(top_by_ratio["ratio"], 2),
            "count": top_by_ratio["count"],
            "basis": "holding_weight",
            "source": "top_stock_holdings",
            "top_share": round(top_share, 2),
            "count_share": round(top_by_ratio["count"] / valid_count * 100, 2) if valid_count else 0.0,
            "valid_count": valid_count,
            "has_weight": True,
        }

    if total_ratio > 0 and top["count"] >= 3 and top_share >= 45:
        return {
            "name": top["name"],
            "ratio": round(top["ratio"], 2),
            "count": top["count"],
            "basis": "holding_weight",
            "source": "top_stock_holdings",
            "top_share": round(top_share, 2),
            "count_share": round(count_share, 2),
            "valid_count": valid_count,
            "has_weight": True,
        }

    if fallback_tag:
        fallback = dict(fallback_tag)
        fallback.update(
            {
                "ratio": round(top_by_ratio["ratio"], 2),
                "count": top_by_ratio["count"],
                "top_share": round(top_share, 2),
                "count_share": round(top_by_ratio["count"] / valid_count * 100, 2) if valid_count else 0.0,
                "valid_count": valid_count,
                "has_weight": total_ratio_count > 0,
                "holding_top_industry": top_by_ratio["name"],
            }
        )
        return fallback

    return {
        "name": "混合型",
        "ratio": round(top_by_ratio["ratio"], 2),
        "count": top_by_ratio["count"],
        "basis": "mixed",
        "source": "top_stock_holdings",
        "top_share": round(top_share, 2),
        "count_share": round(top_by_ratio["count"] / valid_count * 100, 2) if valid_count else 0.0,
        "valid_count": valid_count,
        "has_weight": total_ratio_count > 0,
    }


def _build_industry_tag_from_cached_holdings(raw_holdings, industry_lookup, fund_name=None, fund_type=None):
    holdings = _portfolio_holding_items(raw_holdings)
    enhanced = []
    for item in holdings:
        info = industry_lookup.get(item.get("code"), {})
        enhanced.append({**item, "industry": info.get("industry")})
    return _build_portfolio_industry_tag(
        {
            "stock_codes_new": enhanced,
            "fund_name": fund_name,
            "fund_type": fund_type,
        }
    )
