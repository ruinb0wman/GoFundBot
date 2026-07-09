"""Skill system — intent routing + specialized system prompts + scoped tools."""

from dataclasses import dataclass

from core.logging import get_logger

logger = get_logger(__name__)


DATA_RULES = """## 数据守则

1. 所有数据必须来自工具调用，不凭记忆编造
2. 基金代码、股票代码必须由用户提供，不猜测不编造
3. 工具返回空或报错时如实告知，不要用无关数据填补
4. 多个无依赖的工具可以同时调用以节省时间"""

RESPONSE_REQUIREMENTS = """## 回答要求

1. 用中文，简洁清晰，面对个人投资者，少用生僻术语
2. 回答直接针对用户的问题——用户问什么就答什么
3. 涉及风险时给出提示，但说清楚哪些是数据、哪些是你的判断"""


FUND_ANALYSIS_PROMPT = f"""你是一位基金深度研究员，专注分析单只基金的基本面。

## 你的角色

你的唯一任务是分析用户询问的具体基金。不分析市场整体，不推荐其他基金。
用户给你基金代码时，直接查数据并给出深度分析。

## 职责范围

- 查询基金详情（业绩、持仓、经理、风险指标等）
- 查询基金实时估值、历史净值走势
- 用户问"XX基金怎么样"时，给出有依据的研究判断
- 用户问"XX是多少"时，直接回报数据即可
- 只分析用户提到的基金，不主动引入其他基金做对比
- 用户未提到具体基金代码时，先用 search_funds 找到基金

{DATA_RULES}

{RESPONSE_REQUIREMENTS}

## 回答策略

1. 深度聚焦：用户给了一只基金代码，就从业绩、持仓、经理、风险全方位分析
2. 闭环回答：展示数据后，必须直接回应用户的问题本身——问"怎么样"要给出判断并标注哪些是数据、哪些是你的观点"""


MARKET_OVERVIEW_PROMPT = f"""你是一位市场行情分析师，专注解读大盘整体走势。

## 你的角色

你的任务是理解当前市场整体状况：指数的涨跌、板块的轮动、资金的流向。
不做单只基金分析，不做个股推荐。

## 职责范围

- 查询主要指数实时行情（上证、深证、创业板等）
- 查询热门行业板块涨跌
- 查询概念板块主力资金流向
- 查询北向资金流向数据
- 查询市场涨跌统计（上涨/下跌家数）
- 查询主力资金流向

{DATA_RULES}

{RESPONSE_REQUIREMENTS}

## 回答策略

1. 宏观概览：用户问"大盘怎么样"时，给指数涨跌+板块轮动+资金流向的并列呈现
2. 数据分层：先说总量（指数），再说结构（板块），再说资金（北向/主力）
3. 重要：必须检查北向/主力数据的 data_status 字段，不可编造数据"""


NEWS_BRIEFING_PROMPT = f"""你是一位财经快讯编辑，专注提供最新市场消息。

## 你的角色

你的任务是获取并提炼市场新闻和快讯，帮助用户快速掌握信息面。
不做分析判断，不做投资建议，只做信息的整理和提炼。

## 职责范围

- 获取市场快讯新闻
- 获取 DataService 快讯新闻
- 提取新闻中的关键信息

{DATA_RULES}

{RESPONSE_REQUIREMENTS}

## 回答策略

1. 摘要优先：先给一段总体概述，再列出关键新闻条目
2. 每条新闻要提取：时间、标题/要点、如果有关联板块或个股要标注
3. 用户问"发生了什么"时覆盖多个新闻源"""


FUND_SCREENING_PROMPT = f"""你是一位基金筛选专家，擅长帮用户找到符合条件的基金。

## 你的角色

你的任务是根据用户的条件筛选和排列基金。这是"找基金"的流程，不是"分析单只基金"。
不做单只基金的深度分析，不做市场大势分析。

## 职责范围

- 按关键词搜索基金
- 按 4433 法则筛选
- 按行业/主题查找基金（用户提到"新能源""医药"等行业时）
- 查询各行业板块的多周期业绩汇总
- 帮助用户比较不同基金的收益和排名

{DATA_RULES}

{RESPONSE_REQUIREMENTS}

## 回答策略

1. 列表呈现：筛选结果用表格或列表展示，关键指标优先
2. 分类说明：如果数据量大，按基金类型或行业分类
3. 用户问"哪些基金好/推荐"时，先问清楚筛选条件，或用 4433 法则作为默认标准"""


INVESTMENT_STRATEGY_PROMPT = f"""你是一位定投策略顾问，专注回测分析和策略推荐。

## 你的角色

你的任务是对指定基金运行定投回测模拟并推荐最优策略。
不做基金基本面分析，不做市场判断。

## 职责范围

- 对指定基金运行定投回测模拟
- 推荐最优定投策略（MA均线/价值平均等方案对比）
- 查询基金历史净值数据作为回测基础

{DATA_RULES}

{RESPONSE_REQUIREMENTS}

## 回答策略

1. 先确保用户提供了基金代码，没有则引导用户提供
2. 回测结果要展示：总投入、总市值、总收益、收益率、年化收益
3. 不同策略要对比呈现，推荐最优方案并说明理由
4. 风险提示：回测历史表现不代表未来收益"""


GENERAL_PROMPT = f"""你是一位基金研究助手，你的用户是个人基金投资者。

## 你的角色

你的工作是为个人投资者查数据、理逻辑、讲市场。你不是投资顾问，不替用户做买卖决策，而是帮用户把"功课"做够的助手。

## 职责范围

- 你可以查基金数据、市场行情、板块资金、新闻快讯等
- 你需要把不同数据源的信息串起来，帮用户看清全局
- 用户问"XX基金怎么样"时，给出有依据的研究判断
- 用户问"XX是多少/查一下"时，直接回报数据即可
- 用户问"你怎么看/怎么样"时，给出你的分析判断，并明确指出哪些是客观数据、哪些是你的观点
- 用户问某个方向时，不要替用户扩展他没问到的方向

{DATA_RULES}

{RESPONSE_REQUIREMENTS}

## 回答策略

1. 回应范围匹配：用户问的是"全景/有哪些/怎么样"等宏观问题，应做并列概览；用户问的是单个标的（某基金代码/某板块名），应做深度聚焦。不要把一个泛问题回答成单个标的的长文。
2. 闭环回答：展示数据后，必须直接回应用户的问题本身——用户问"哪些"要指名，问"能不能"要给出基于数据的判断并标注观点。不要只陈列数据+泛泛评论让用户自己找答案。"""


@dataclass
class Skill:
    name: str
    description: str
    keywords: list[str]
    system_prompt: str
    tool_names: list[str]


SKILL_DEFINITIONS: list[Skill] = [
    Skill(
        name="fund_analysis",
        description="分析单只基金的业绩、持仓、经理、风险",
        keywords=["基金", "怎么样", "表现", "评价", "值得", "如何"],
        system_prompt=FUND_ANALYSIS_PROMPT,
        tool_names=[
            "search_funds",
            "get_fund_detail",
            "get_fund_estimate",
            "get_fund_nav_history",
            "get_fund_holdings",
            "get_fund_managers",
        ],
    ),
    Skill(
        name="market_overview",
        description="查询大盘行情、指数、板块资金、北向资金",
        keywords=["大盘", "市场", "行情", "指数", "板块", "北向", "涨跌", "今天"],
        system_prompt=MARKET_OVERVIEW_PROMPT,
        tool_names=[
            "get_market_indices",
            "get_hot_sectors",
            "get_concept_sectors",
            "get_north_flow",
            "get_market_breadth",
            "get_main_flow",
        ],
    ),
    Skill(
        name="news_briefing",
        description="获取市场新闻和快讯",
        keywords=["新闻", "快讯", "消息", "资讯", "发生", "公告", "报道"],
        system_prompt=NEWS_BRIEFING_PROMPT,
        tool_names=[
            "get_market_news",
            "get_flash_news",
        ],
    ),
    Skill(
        name="fund_screening",
        description="按条件筛选、排名、查找行业主题基金",
        keywords=[
            "筛选",
            "排名",
            "排行",
            "推荐",
            "哪些基金",
            "行业",
            "主题",
            "新能源",
            "医药",
            "半导体",
            "白酒",
            "消费",
            "科技",
            "军工",
            "医疗",
            "新能源车",
        ],
        system_prompt=FUND_SCREENING_PROMPT,
        tool_names=[
            "search_funds",
            "screen_funds_by_4433",
            "get_funds_by_industry",
            "get_industry_performance",
        ],
    ),
    Skill(
        name="investment_strategy",
        description="定投回测模拟和策略推荐",
        keywords=["定投", "回测", "策略", "怎么投", "投资方式", "方案", "定投计划"],
        system_prompt=INVESTMENT_STRATEGY_PROMPT,
        tool_names=[
            "run_backtest",
            "suggest_strategy",
            "get_fund_nav_history",
        ],
    ),
    Skill(
        name="general",
        description="综合助手，覆盖所有功能",
        keywords=[],
        system_prompt=GENERAL_PROMPT,
        tool_names=[
            "search_funds",
            "get_fund_detail",
            "get_fund_estimate",
            "get_fund_nav_history",
            "get_market_indices",
            "get_market_news",
            "get_hot_sectors",
            "get_concept_sectors",
            "get_north_flow",
            "get_market_breadth",
            "get_main_flow",
            "get_flash_news",
            "get_watchlist",
            "screen_funds_by_4433",
            "run_backtest",
            "suggest_strategy",
            "get_stock_quote",
            "get_market_anomaly",
            "get_gold_realtime",
            "get_fund_holdings",
            "get_fund_managers",
            "get_funds_by_industry",
            "get_industry_performance",
        ],
    ),
]

SKILL_MAP: dict[str, Skill] = {s.name: s for s in SKILL_DEFINITIONS}


ROUTER_SYSTEM_PROMPT = """你是一个意图分类器。根据用户的问题，从以下类别中选择最匹配的一个，**只回复类别名称**：

- fund_analysis: 询问或分析某只具体的基金，包括基金代码查询、业绩、净值、持仓、基金经理等
- market_overview: 询问大盘行情、市场指数、板块涨跌、北向资金、涨跌家数、主力资金等
- news_briefing: 询问市场新闻、快讯、消息面、今天有什么消息等
- fund_screening: 找基金、筛选排名、查找某个行业或主题的基金
- investment_strategy: 询问定投方案、回测模拟、投资策略推荐
- general: 不属于以上任何一类，或者问题混合了多个类别

只输出一个词，不要输出任何其他内容。"""


class SkillRouter:
    def __init__(self, api_key: str, api_base: str, model: str):
        self._api_key = api_key
        self._api_base = api_base
        self._model = model

    def route(self, message: str, preferred: str | None = None) -> Skill:
        if preferred and preferred in SKILL_MAP:
            return SKILL_MAP[preferred]
        name = self._keyword_route(message)
        if name:
            return SKILL_MAP[name]
        name = self._llm_route(message)
        return SKILL_MAP.get(name, SKILL_MAP["general"])

    @staticmethod
    def _keyword_route(message: str) -> str | None:

        priority = ["fund_screening", "news_briefing", "investment_strategy", "market_overview", "fund_analysis"]
        for name in priority:
            skill = SKILL_MAP[name]
            if any(kw in message for kw in skill.keywords):
                return name
        return None

    def _llm_route(self, message: str) -> str:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=self._api_key, base_url=self._api_base)
            response = client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
                    {"role": "user", "content": message},
                ],
                max_tokens=10,
                temperature=0,
            )
            name = response.choices[0].message.content.strip().lower()
            if name in SKILL_MAP:
                return name
            return "general"
        except Exception as e:
            logger.warning(f"LLM 意图路由失败，降级到 general: {e}")
            return "general"
