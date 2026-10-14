"""同花顺板块成分股（`q.10jqka.com.cn`）——东财 push2 被限流时的成分股来源。

为什么需要：`/api/market/sectors/:code/constituents` 原本只有东财 `clist/get` 一条路，
而它是**路径级限流**的（密集请求后整段拒绝，IPv4/IPv6 一起挂，实测持续数小时，
见 `.pi/plans/push2-resilience.md` §5）；更要命的是行业板块在 THS 降级时 `code` 是空串，
那条数据根本没法用 code 去查成分股 —— 而这条 THS 路只需要**板块名**。

实现要点（都是实测踩出来的）：
- 板块名 → 同花顺代码：`ak.stock_board_industry_name_ths()`（90 个）/ `stock_board_concept_name_ths()`
  （375 个，~7s，两个都 file_cache 24h；概念表**按需**才拉）。
- 成分股页用**普通页 + `page/N/`**，不用 ajax 变体：`.../ajax/1/...` 要 `hexin-v` 令牌会 **401**，
  普通页 **不需要任何令牌**（0.3s/页，20 行/页）。
- `代码` 列被 pandas 读成整数（`002371` → `2371`）→ 必须 **zfill(6)**。
- `流通市值` / `成交额` 是带「亿/万」的字符串 → 要换算成数值（DTO 那边是元）。
"""

import re
import time
from io import StringIO

import pandas as pd
import requests

from cli.shared.file_cache import file_cache

_PAGE_URL = "http://q.10jqka.com.cn/{kind}/detail/code/{code}/"
_PAGE_URL_N = "http://q.10jqka.com.cn/{kind}/detail/code/{code}/page/{page}/"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "http://q.10jqka.com.cn/",
}
_KIND_LABEL = {"thshy": "industry", "gn": "concept"}
MAX_PAGES = 30  # 行业最多 10 页（20 行/页），留余量
PAGE_ATTEMPTS = 2


@file_cache(key="ths_industry_table", ttl_hours=24)
def _industry_table() -> dict:
    """`{板块名: 同花顺行业代码}`（90 个）。"""
    import akshare as ak

    df = ak.stock_board_industry_name_ths()
    if df is None or df.empty:
        raise RuntimeError("ths industry table returned no rows")
    return {str(r["name"]).strip(): str(r["code"]).strip() for _, r in df.iterrows() if str(r["name"]).strip()}


@file_cache(key="ths_concept_table", ttl_hours=24)
def _concept_table() -> dict:
    """`{概念名: 同花顺概念代码}`（375 个，约 7s，所以只在行业表没命中时才拉）。"""
    import akshare as ak

    df = ak.stock_board_concept_name_ths()
    if df is None or df.empty:
        raise RuntimeError("ths concept table returned no rows")
    return {str(r["name"]).strip(): str(r["code"]).strip() for _, r in df.iterrows() if str(r["name"]).strip()}


def resolve_board(name: str) -> tuple[str, str]:
    """板块名 → `(同花顺代码, kind)`；查不到抛异常（不返回空）。"""
    target = name.strip()
    if not target:
        raise RuntimeError("板块名为空")

    industry = _industry_table()
    if target in industry:
        return industry[target], "thshy"

    # 同花顺的概念表常带「概念」后缀，而资金流里的名字没有 —— 两边都试
    concept = _concept_table()
    if target in concept:
        return concept[target], "gn"
    with_suffix = f"{target}概念"
    if with_suffix in concept:
        return concept[with_suffix], "gn"

    raise RuntimeError(f"同花顺板块表里找不到「{target}」（行业 {len(industry)} 个 / 概念 {len(concept)} 个）")


def _to_number(value: object) -> float | None:
    text = str(value).strip().replace(",", "")
    if not text or text in {"-", "--", "nan"}:
        return None
    multiplier = 1.0
    if text.endswith("亿"):
        multiplier, text = 1e8, text[:-1]
    elif text.endswith("万"):
        multiplier, text = 1e4, text[:-1]
    text = text.rstrip("%")
    try:
        return float(text) * multiplier
    except ValueError:
        return None


def _pick_table(tables: list[pd.DataFrame]) -> pd.DataFrame | None:
    """从页面里的多个表里挑出**成分股表**。

    不能直接取 `tables[0]`：概念详情页的表顺序不固定（例：`gn/detail/code/301050/` 的
    `[0]` 是「开发商/运营商/其他」分类表，成分股在 `[1]`）。另外无成分股时同花顺会回一行
    占位文本「暂无成份股数据」—— 那个表有 `代码` 表头但没有真代码，必须一起排掉。
    """
    for table in tables:
        if "代码" not in table.columns:
            continue
        codes = table["代码"].astype(str).str.strip()
        if codes.str.fullmatch(r"\d+").any():
            return table
    return None


def _fetch_page(kind: str, code: str, page: int) -> tuple[pd.DataFrame | None, int | None]:
    """取一页成分股；`(None, None)` = 这一页拿不到表（到底或上游降级）。

    只有「连表格都没有」才重试：**0 行/占位行的表是正常终止页**。
    """
    url = _PAGE_URL.format(kind=kind, code=code) if page == 1 else _PAGE_URL_N.format(kind=kind, code=code, page=page)
    for attempt in range(PAGE_ATTEMPTS):
        resp = requests.get(url, headers=_HEADERS, timeout=15)
        try:
            tables = pd.read_html(StringIO(resp.text))
        except ValueError:
            tables = []
        table = _pick_table(tables)
        if table is not None:
            m = re.search(r'class="page_info"[^>]*>\s*\d+\s*/\s*(\d+)', resp.text)
            return table, (int(m.group(1)) if m else None)
        if attempt < PAGE_ATTEMPTS - 1:
            time.sleep(0.8)
    return None, None


def fetch_board_constituents(name: str) -> dict:
    """按板块名取成分股（同花顺）。

    返回 `{name, code, board_type, items}`；`items[].code` 是 6 位补零代码，
    `market_value` 是元、`pe` 是倍、`turnover_rate` / `change_pct` 是百分数。
    """
    code, kind = resolve_board(name)

    frames: list[pd.DataFrame] = []
    total_pages: int | None = None
    page = 1
    while page <= (total_pages if total_pages is not None else MAX_PAGES):
        df_page, page_info = _fetch_page(kind, code, page)
        if df_page is None or df_page.empty:
            break
        frames.append(df_page)
        if page_info is not None:
            total_pages = page_info
        page += 1

    if not frames:
        raise RuntimeError(f"同花顺「{name}」({code}) 成分股页面没有返回表格")

    df = pd.concat(frames, ignore_index=True)
    items = []
    for _, row in df.iterrows():
        raw_code = str(row.get("代码", "")).strip()
        if not raw_code or not raw_code.isdigit():
            continue
        turnover = _to_number(row.get("换手(%)"))
        items.append(
            {
                "code": raw_code.zfill(6),
                "name": str(row.get("名称", "") or "").strip(),
                "price": _to_number(row.get("现价")),
                "change_pct": _to_number(row.get("涨跌幅(%)")),
                "market_value": _to_number(row.get("流通市值")),
                "pe": _to_number(row.get("市盈率")),
                "turnover_rate": None if turnover is None else turnover,
            }
        )

    if not items:
        raise RuntimeError(f"同花顺「{name}」({code}) 成分股解析后为空")

    return {"name": name.strip(), "code": code, "board_type": _KIND_LABEL.get(kind, kind), "items": items}
