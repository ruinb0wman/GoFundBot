import json
import re
import math
from datetime import datetime, timedelta


def _json_dumps(data):
    return json.dumps(data, ensure_ascii=False) if data is not None else None


def _json_loads(data, default):
    if not data:
        return default
    try:
        return json.loads(data)
    except Exception:
        return default


def _normalize_fund_code(code):
    code = str(code or '').strip()
    return code.zfill(6) if re.match(r'^\d{1,6}$', code) else code


def _value_to_string(value):
    if value is None:
        return None
    return str(value)


def _normalize_date(value):
    if not value:
        return ''
    text = str(value).strip()
    match = re.search(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', text)
    if match:
        return '{}-{:02d}-{:02d}'.format(
            match.group(1),
            int(match.group(2)),
            int(match.group(3)),
        )
    return text


def _extract_date_text(value):
    if not value:
        return ''
    match = re.search(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}', str(value))
    return match.group(0).replace('/', '-') if match else ''


def _estimate_is_after_nav(estimate_time, nav_date):
    estimate_date = _normalize_date(estimate_time)
    official_date = _normalize_date(nav_date)
    return bool(estimate_date and official_date and estimate_date > official_date)


def _trend_daily_return(rows):
    if not isinstance(rows, list) or not rows:
        return None

    normalized = [
        row for row in rows
        if isinstance(row, dict) and row.get('date') is not None and row.get('net_worth') is not None
    ]
    if not normalized:
        return None

    normalized.sort(key=lambda item: _normalize_date(item.get('date')))
    latest = normalized[-1]
    daily_return = _first_present(latest, ('dailyReturn', 'equityReturn', 'growth_rate'))
    if daily_return is not None:
        return daily_return

    if len(normalized) >= 2:
        try:
            prev_nav = float(normalized[-2].get('net_worth'))
            curr_nav = float(latest.get('net_worth'))
            if prev_nav:
                return round((curr_nav - prev_nav) / prev_nav * 100, 4)
        except Exception:
            return None
    return None


def _first_present(mapping, keys):
    for key in keys:
        if isinstance(mapping, dict) and key in mapping and mapping.get(key) is not None:
            return mapping.get(key)
    return None


def _to_float(value):
    if value is None or value == '' or value == '--':
        return None
    try:
        text = str(value).replace('%', '').replace(',', '').strip()
        return float(text)
    except (TypeError, ValueError):
        return None


def _round_or_none(value, digits=2):
    num = _to_float(value)
    return round(num, digits) if num is not None else None


def _median(values):
    nums = sorted(v for v in (_to_float(item) for item in values) if v is not None)
    if not nums:
        return None
    mid = len(nums) // 2
    if len(nums) % 2:
        return round(nums[mid], 2)
    return round((nums[mid - 1] + nums[mid]) / 2, 2)


def _avg(values):
    nums = [v for v in (_to_float(item) for item in values) if v is not None]
    return round(sum(nums) / len(nums), 2) if nums else None


def _positive_rate(values):
    nums = [v for v in (_to_float(item) for item in values) if v is not None]
    return round(sum(1 for v in nums if v > 0) / len(nums) * 100, 2) if nums else None


def is_data_fresh(updated_time, days=7):
    if not updated_time:
        return False
    return (datetime.now() - updated_time).days < days


def _stats_numbers(values):
    nums = []
    for value in values:
        num = _to_float(value)
        if num is not None:
            nums.append(num)
    nums.sort()
    if not nums:
        return {'avg': None, 'median': None, 'positive_rate': None, 'count': 0}
    mid = len(nums) // 2
    median = nums[mid] if len(nums) % 2 else (nums[mid - 1] + nums[mid]) / 2
    return {
        'avg': round(sum(nums) / len(nums), 2),
        'median': round(median, 2),
        'positive_rate': round(sum(1 for num in nums if num > 0) / len(nums) * 100, 2),
        'count': len(nums),
    }
