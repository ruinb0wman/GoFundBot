"""同花顺概念资金流（`data.10jqka.com.cn/funds/gnzjl/`）—— 自己翻页，不依赖 akshare。

**为什么不用 `ak.stock_fund_flow_concept`**（只沿用它的输出列名口径）：akshare 先请求一次列表页、
从 HTML 里取 `span.page_info` 算总页数，而该页在 CDN/限流下经常**只有表格、没有分页控件**
（2026-10-14 实测同一分钟内 5/5 都没 page_info、但 25 行数据都在）→ akshare 直接
`AttributeError: 'NoneType' object has no attribute 'text'`，而我们其实用不着它。
这里自己翻页，**page_info 有就用、没有就一直翻到空页**，并带上超时（akshare 那条是裸 requests 无 timeout）。

实测这个端点**不校验 `hexin-v`**（无 token / 假 token / 无 UA 都返回同样内容），
所以不需要 py_mini_racer 与 akshare 的私有 helper。
"""

import re
import time
from io import StringIO

import pandas as pd
import requests

CONCEPT_URL = "http://data.10jqka.com.cn/funds/gnzjl/field/tradezdf/order/desc/page/{page}/ajax/1/free/1/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "http://data.10jqka.com.cn/funds/gnzjl/",
    "X-Requested-With": "XMLHttpRequest",
}
# 与 akshare `stock_fund_flow_concept(symbol="即时")` 的输出列**逐位对齐**（下游按这些中文列名取值）；
# 改动顺序会静默搅乱所有字段。
COLUMNS = [
    "序号",
    "行业",
    "行业指数",
    "行业-涨跌幅",
    "流入资金",
    "流出资金",
    "净额",
    "公司家数",
    "领涨股",
    "领涨股-涨跌幅",
    "当前价",
]
MAX_PAGES = 15  # 约 500 个概念、每页 25~50 行；上限只是防呆
PAGE_ATTEMPTS = 2  # 同一页“完全没有表格”时重试一次（实测上游会几秒内反复变样）


def _fetch_page(page: int) -> tuple[pd.DataFrame | None, int | None]:
    """取一页，返回 `(表格, page_info 里的总页数)`；拿不到表格时返回 `(None, None)`。

    只有“连表格都没有”才算失败并重试：**0 行的表是正常终止页**（翻到底），
    对它重试只会白多花一次请求。
    """
    for attempt in range(PAGE_ATTEMPTS):
        resp = requests.get(CONCEPT_URL.format(page=page), headers=HEADERS, timeout=15)
        try:
            tables = pd.read_html(StringIO(resp.text))
        except ValueError:  # 页面上没有表格
            tables = []
        if tables and tables[0].shape[1] == len(COLUMNS):
            m = re.search(r'class="page_info"[^>]*>\s*\d+\s*/\s*(\d+)', resp.text)
            return tables[0], (int(m.group(1)) if m else None)
        if attempt < PAGE_ATTEMPTS - 1:
            time.sleep(0.8)
    return None, None


def _all_pages() -> pd.DataFrame:
    """翻页取全表并按同花顺口径整理列名。

    效果：按涨跌幅降序的排名表，**头部（前几页）可靠，尾部可能被截短** —— 同花顺的 CDN 会同时发
    多个版本（实测同一分钟内 `page_info` 时而 8、时而 3，连续三次取数得到 337/250/200 行，
    甚至榜首都不同），所以“翻到空页为止”拿到的行数会抖动。消费方按 limit 取前 N 名不受影响，
    但要拿它当“全量概念清单”就不行。
    """
    frames: list[pd.DataFrame] = []
    total_pages: int | None = None
    page = 1
    while page <= (total_pages if total_pages is not None else MAX_PAGES):
        df_page, page_info = _fetch_page(page)
        if df_page is None or df_page.empty:  # 到底是降级/翻到底，两者都停
            break
        frames.append(df_page)
        if page_info is not None:
            total_pages = page_info
        page += 1

    if not frames:
        raise RuntimeError("同花顺概念资金流没有返回任何表格")

    df = pd.concat(frames, ignore_index=True)
    df = df.drop(columns=["序号"], errors="ignore").reset_index(drop=True)
    df.insert(0, "序号", range(1, len(df) + 1))
    df.columns = COLUMNS  # 位置对齐（与 akshare 同款做法，表头文案不一致也能用）
    for col in ("行业-涨跌幅", "领涨股-涨跌幅"):
        df[col] = pd.to_numeric(df[col].astype(str).str.strip("%"), errors="coerce")
    return df


def fetch_concept_spot_df(attempts: int = 2) -> pd.DataFrame:
    """拉同花顺概念资金流主表，带一次轻量重试（挡网络抖动）。

    解析层面已经不依赖 `span.page_info`（见 `_all_pages`），所以这里只处理连接/空表这类瞬时故障；
    仍失败就抛异常（**不返回空表**），让调用方明确看到失败、不落缓存。
    """
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            df = _all_pages()
            if not df.empty:
                return df
            last_error = RuntimeError("同花顺概念资金流返回空表")
        except Exception as e:  # noqa: BLE001 - 上游解析/网络什么都可能抛
            last_error = e
        if attempt < attempts - 1:
            time.sleep(0.8)
    raise RuntimeError(f"all {attempts} attempts failed: {last_error}") from last_error
