import json
import re
import time
from datetime import datetime
from sqlalchemy.orm import Session
import requests

from core.logging import get_logger
from services.data_service_client import DataServiceClient, DataServiceError
from services.helpers import _json_dumps, _json_loads, _to_float, _normalize_fund_code
from services.stock_utils import (
    _normalize_stock_code, _is_us_stock_code, _is_a_share_stock_code,
    _safe_ratio, _portfolio_holding_items, _market_hint_from_holdings,
)
from models import StockIndustry

logger = get_logger(__name__)


def _upsert_stock_industry(db: Session, stock_data: dict):
    code = _normalize_stock_code(stock_data.get('code'))
    if not code:
        return None
    record = db.query(StockIndustry).filter(StockIndustry.stock_code == code).first()
    if not record:
        record = StockIndustry(stock_code=code)
        db.add(record)
    concepts = stock_data.get('concepts')
    if not isinstance(concepts, list):
        concepts = []
    record.stock_name = stock_data.get('name') or record.stock_name
    record.industry = stock_data.get('industry') or record.industry
    record.region = stock_data.get('region') or record.region
    record.concepts_json = _json_dumps(concepts)
    record.source = stock_data.get('source') or 'data_service'
    record.updated_time = datetime.now()
    return record


def _stock_industry_payload(record):
    return {
        'stock_code': record.stock_code,
        'stock_name': record.stock_name,
        'industry': record.industry,
        'region': record.region,
        'concepts': _json_loads(record.concepts_json, []),
        'source': record.source,
        'updated_time': record.updated_time.isoformat() if record.updated_time else None,
    }


def _fetch_stock_industry_batch(db: Session, codes, force_refresh=False, timeout=None):
    normalized_codes = []
    for code in codes or []:
        normalized = _normalize_stock_code(code)
        if normalized and re.match(r'^\d{5,6}$', normalized) and normalized not in normalized_codes:
            normalized_codes.append(normalized)
    if not normalized_codes:
        return {}, []

    industry_map = {}
    failed_codes = []
    chunk_size = 100
    client = DataServiceClient(timeout=timeout if timeout is not None else (8.0 if force_refresh else 4.0))
    for index in range(0, len(normalized_codes), chunk_size):
        chunk = normalized_codes[index:index + chunk_size]
        try:
            payload = client.get_stock_references(chunk)
            ds_data = payload.get('data', {}) if isinstance(payload, dict) else {}
            ds_items = ds_data.get('items', []) if isinstance(ds_data, dict) else []
            success_codes = set()
            for result in ds_items:
                if not isinstance(result, dict) or not result.get('success'):
                    continue
                stock_data = result.get('data') if isinstance(result.get('data'), dict) else {}
                record = _upsert_stock_industry(db, stock_data)
                if record:
                    industry_map[record.stock_code] = _stock_industry_payload(record)
                    success_codes.add(record.stock_code)
            failed_codes.extend(code for code in chunk if code not in success_codes)
        except DataServiceError as exc:
            logger.error(f"stock industry dictionary: DataService unavailable for {len(chunk)} codes: {exc}")
            failed_codes.extend(chunk)
        except Exception as exc:
            logger.error(f"stock industry dictionary: unexpected error for {len(chunk)} codes: {exc}")
            failed_codes.extend(chunk)
    return industry_map, failed_codes


def _resolve_stock_industries(db: Session, holdings, force_refresh=False, allow_network=False):
    items = _portfolio_holding_items(holdings)
    codes = []
    for item in items:
        code = _normalize_stock_code(item.get('code'))
        if code and code not in codes:
            codes.append(code)
    if not codes:
        return {}, []

    records = db.query(StockIndustry).filter(StockIndustry.stock_code.in_(codes)).all()
    industry_map = {record.stock_code: _stock_industry_payload(record) for record in records}

    need_network = []
    for code in codes:
        if industry_map.get(code, {}).get('industry'):
            continue
        if _is_a_share_stock_code(code) or _is_us_stock_code(code):
            need_network.append(code)

    if allow_network and need_network:
        fetched_map, _ = _fetch_stock_industry_batch(db, need_network, force_refresh=force_refresh)
        industry_map.update(fetched_map)

    for code in codes:
        if industry_map.get(code, {}).get('industry'):
            continue
        if not _is_us_stock_code(code):
            continue
        market_hint = _market_hint_from_holdings(holdings, code)
        record = db.query(StockIndustry).filter(StockIndustry.stock_code == code).first()
        if not record:
            record = StockIndustry(stock_code=code)
            db.add(record)
        record.stock_name = record.stock_name or market_hint.get('name') or code
        record.industry = market_hint.get('industry') or '海外'
        record.region = market_hint.get('region') or 'WW'
        record.source = market_hint.get('source', 'rule.unknown_ticker')
        record.updated_time = datetime.now()
        industry_map[code] = _stock_industry_payload(record)

    unresolved = [code for code in codes if not industry_map.get(code, {}).get('industry')]
    return industry_map, unresolved


def _collect_stock_codes_from_portfolios(db, fund_codes=None):
    from models import FundPortfolio
    query = db.query(FundPortfolio)
    if fund_codes is not None:
        codes = [_normalize_fund_code(code) for code in fund_codes if _normalize_fund_code(code)]
        if not codes:
            return []
        query = query.filter(FundPortfolio.fund_code.in_(codes))

    stock_codes = []
    for portfolio in query.all():
        raw_holdings = _json_loads(portfolio.stock_codes_new_json, []) or _json_loads(portfolio.stock_codes_json, [])
        for item in _portfolio_holding_items(raw_holdings):
            code = _normalize_stock_code(item.get('code'))
            if code and code not in stock_codes:
                stock_codes.append(code)
    return stock_codes


def warm_stock_industry_dictionary(db, fund_codes=None, force=False, limit=None):
    stock_codes = _collect_stock_codes_from_portfolios(db, fund_codes)
    if limit is not None:
        try:
            limit = max(1, int(limit))
            stock_codes = stock_codes[:limit]
        except (TypeError, ValueError):
            pass

    if not stock_codes:
        return {'total': 0, 'cached': 0, 'fetched': 0, 'failed': 0}

    records = db.query(StockIndustry).filter(StockIndustry.stock_code.in_(stock_codes)).all()
    cached_codes = {record.stock_code for record in records if record.industry and not force}
    missing_codes = [code for code in stock_codes if force or code not in cached_codes]
    if not missing_codes:
        return {'total': len(stock_codes), 'cached': len(cached_codes), 'fetched': 0, 'failed': 0}

    fetched_map, failed_codes = _fetch_stock_industry_batch(db, missing_codes, force_refresh=force, timeout=8.0 if force else 5.0)
    db.commit()
    return {'total': len(stock_codes), 'cached': len(cached_codes), 'fetched': len(fetched_map), 'failed': len(failed_codes)}


def _akshare_row_value(row, fallback_index, *names):
    for name in names:
        try:
            value = row.get(name)
            if value is not None:
                return value
        except Exception:
            pass
    try:
        return row.iloc[fallback_index]
    except Exception:
        return None


def build_stock_industry_dictionary_from_akshare(db, force=False, board_limit=None, stock_limit=None):
    try:
        import akshare as ak
    except Exception as exc:
        raise RuntimeError(f"akshare not available: {exc}")

    try:
        board_limit = int(board_limit) if board_limit else None
    except (TypeError, ValueError):
        board_limit = None
    try:
        stock_limit = int(stock_limit) if stock_limit else None
    except (TypeError, ValueError):
        stock_limit = None

    hk_result = build_hk_stock_industry_dictionary_from_eastmoney(db, force=force)

    try:
        result = _build_stock_industry_dictionary_from_sina(db, ak, force=force, board_limit=board_limit, stock_limit=stock_limit)
        result['source'] = 'akshare.sina.sector'
        result['hk'] = hk_result
        return result
    except Exception as exc:
        logger.error(f"akshare sina industry dictionary failed, fallback to eastmoney: {exc}")
        board_df = ak.stock_board_industry_name_em()
        result = _build_stock_industry_dictionary_from_em_boards(db, ak, board_df, force=force, board_limit=board_limit, stock_limit=stock_limit)
        result['source'] = 'akshare.eastmoney.industry_board'
        result['hk'] = hk_result
        return result


def build_hk_stock_industry_dictionary_from_eastmoney(db, force=False, page_size=500):
    url = 'https://datacenter.eastmoney.com/securities/api/data/v1/get'
    columns = 'SECUCODE,SECURITY_CODE,ORG_NAME,ORG_EN_ABBR,BELONG_INDUSTRY,REG_PLACE'
    updated = 0
    skipped = 0
    fetched = 0
    failed_pages = 0
    page = 1
    total_pages = None

    while total_pages is None or page <= total_pages:
        params = {
            'reportName': 'RPT_HKF10_INFO_ORGPROFILE',
            'columns': columns,
            'quoteColumns': '',
            'pageNumber': str(page),
            'pageSize': str(page_size),
            'sortTypes': '',
            'sortColumns': '',
            'source': 'F10',
            'client': 'PC',
            'v': str(int(time.time() * 1000)),
        }
        try:
            response = requests.get(url, params=params, timeout=12)
            response.raise_for_status()
            payload = response.json()
            result = payload.get('result') if isinstance(payload, dict) else {}
            rows = result.get('data') if isinstance(result, dict) else []
            if total_pages is None:
                total_pages = int(result.get('pages') or 0) if isinstance(result, dict) else 0
            if not rows:
                break
        except Exception as exc:
            failed_pages += 1
            logger.error(f"eastmoney hk industry dictionary: failed page {page}: {exc}")
            break

        for row in rows:
            if not isinstance(row, dict):
                continue
            stock_code = _normalize_stock_code(row.get('SECURITY_CODE'))
            if not stock_code or not re.match(r'^\d{5}$', stock_code):
                continue
            industry = str(row.get('BELONG_INDUSTRY') or '').strip()
            if not industry:
                continue
            fetched += 1
            record = db.query(StockIndustry).filter(StockIndustry.stock_code == stock_code).first()
            if not record:
                record = StockIndustry(stock_code=stock_code)
                db.add(record)
            elif record.industry and not force:
                skipped += 1
                continue
            record.stock_name = str(row.get('ORG_NAME') or record.stock_name or '')
            record.industry = industry
            record.region = str(row.get('REG_PLACE') or record.region or '')
            concepts = _json_loads(record.concepts_json, [])
            if industry not in concepts:
                concepts.append(industry)
            record.concepts_json = _json_dumps(concepts[:20])
            record.source = 'eastmoney.hk.company_profile'
            record.updated_time = datetime.now()
            updated += 1

        if page % 5 == 0:
            db.commit()
        page += 1

    db.commit()
    return {'fetched': fetched, 'created_or_updated': updated, 'skipped': skipped, 'failed_pages': failed_pages, 'pages': total_pages or 0}


def _build_stock_industry_dictionary_from_em_boards(db, ak, board_df, force=False, board_limit=None, stock_limit=None):
    if board_df is None or getattr(board_df, 'empty', True):
        return {'boards': 0, 'stocks': 0, 'created_or_updated': 0, 'skipped': 0, 'failed_boards': 0}

    boards = []
    for _, row in board_df.iterrows():
        name = _akshare_row_value(row, 1, '板块名称', '行业名称', '名称', 'name')
        code = _akshare_row_value(row, 0, '板块代码', '代码', 'code')
        if name:
            boards.append({'name': str(name), 'code': str(code or '')})
    if board_limit:
        boards = boards[:board_limit]

    updated = 0
    skipped = 0
    seen_stocks = set()
    failed_boards = 0
    for index, board in enumerate(boards, 1):
        if stock_limit and len(seen_stocks) >= stock_limit:
            break
        try:
            cons_df = ak.stock_board_industry_cons_em(symbol=board['name'])
        except Exception as exc:
            failed_boards += 1
            logger.error(f"akshare stock industry dictionary: failed board {board['name']}: {exc}")
            continue
        if cons_df is None or getattr(cons_df, 'empty', True):
            continue
        for _, stock_row in cons_df.iterrows():
            if stock_limit and len(seen_stocks) >= stock_limit:
                break
            stock_code = _normalize_stock_code(_akshare_row_value(stock_row, 1, '代码', '股票代码', 'code'))
            if not stock_code or not re.match(r'^\d{6}$', stock_code):
                continue
            if stock_code in seen_stocks:
                continue
            seen_stocks.add(stock_code)
            record = db.query(StockIndustry).filter(StockIndustry.stock_code == stock_code).first()
            if not record:
                record = StockIndustry(stock_code=stock_code)
                db.add(record)
            elif record.industry and not force:
                skipped += 1
                continue
            record.stock_name = str(_akshare_row_value(stock_row, 2, '名称', '股票名称', 'name') or record.stock_name or '')
            record.industry = board['name']
            record.region = record.region or ''
            concepts = _json_loads(record.concepts_json, [])
            if board['name'] not in concepts:
                concepts.append(board['name'])
            record.concepts_json = _json_dumps(concepts[:20])
            record.source = 'akshare.eastmoney.industry_board'
            record.updated_time = datetime.now()
            updated += 1
        if index % 10 == 0:
            db.commit()
    db.commit()
    return {'boards': len(boards), 'stocks': len(seen_stocks), 'created_or_updated': updated, 'skipped': skipped, 'failed_boards': failed_boards}


def _build_stock_industry_dictionary_from_sina(db, ak, force=False, board_limit=None, stock_limit=None):
    board_df = ak.stock_sector_spot()
    if board_df is None or getattr(board_df, 'empty', True):
        return {'boards': 0, 'stocks': 0, 'created_or_updated': 0, 'skipped': 0, 'failed_boards': 0}

    boards = []
    for _, row in board_df.iterrows():
        label = row.get('label') if hasattr(row, 'get') else None
        name = _akshare_row_value(row, 1, '行业', '板块', 'name')
        if label and name:
            boards.append({'label': str(label), 'name': str(name)})
    if board_limit:
        boards = boards[:board_limit]

    updated = 0
    skipped = 0
    seen_stocks = set()
    failed_boards = 0
    for index, board in enumerate(boards, 1):
        if stock_limit and len(seen_stocks) >= stock_limit:
            break
        try:
            cons_df = ak.stock_sector_detail(sector=board['label'])
        except Exception as exc:
            failed_boards += 1
            logger.error(f"akshare sina industry dictionary: failed board {board['name']}: {exc}")
            continue
        if cons_df is None or getattr(cons_df, 'empty', True):
            continue
        for _, stock_row in cons_df.iterrows():
            if stock_limit and len(seen_stocks) >= stock_limit:
                break
            stock_code = _normalize_stock_code(stock_row.get('code') if hasattr(stock_row, 'get') else None)
            if not stock_code or not re.match(r'^\d{6}$', stock_code):
                continue
            if stock_code in seen_stocks:
                continue
            seen_stocks.add(stock_code)
            record = db.query(StockIndustry).filter(StockIndustry.stock_code == stock_code).first()
            if not record:
                record = StockIndustry(stock_code=stock_code)
                db.add(record)
            elif record.industry and not force:
                skipped += 1
                continue
            record.stock_name = str(stock_row.get('name') if hasattr(stock_row, 'get') else None or record.stock_name or '')
            record.industry = board['name']
            record.region = record.region or ''
            concepts = _json_loads(record.concepts_json, [])
            if board['name'] not in concepts:
                concepts.append(board['name'])
            record.concepts_json = _json_dumps(concepts[:20])
            record.source = 'akshare.sina.sector'
            record.updated_time = datetime.now()
            updated += 1
        if index % 10 == 0:
            db.commit()
    db.commit()
    return {'boards': len(boards), 'stocks': len(seen_stocks), 'created_or_updated': updated, 'skipped': skipped, 'failed_boards': failed_boards}
