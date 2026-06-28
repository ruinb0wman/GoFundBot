from datetime import datetime
from flask import Blueprint, jsonify, request

from core.validation import validate_body
from core.logging import get_logger
from database import get_request_db as get_db
from models import FundTrend
from services.helpers import _json_loads
from services.backtest import _run_backtest
from schemas.backtest_schemas import FixedInvestmentSchema

logger = get_logger(__name__)

backtest_bp = Blueprint('backtest', __name__, url_prefix='/api/backtest')


@backtest_bp.route('/fixed-investment', methods=['POST'])
@validate_body(FixedInvestmentSchema)
def backtest_fixed_investment():
    data = request.get_json()

    try:
        fund_code = data.get('fund_code')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        investment_type = data.get('investment_type', 'monthly')

        def safe_float(val, default):
            if val is None or val == '':
                return default
            return float(val)

        amount = safe_float(data.get('amount'), 1000)
        initial_amount = safe_float(data.get('initial_amount'), 0)
        fee_rate = safe_float(data.get('fee_rate'), 0.15) / 100

        take_profit_rate = data.get('take_profit_rate')
        if take_profit_rate is not None and take_profit_rate != '':
            take_profit_rate = float(take_profit_rate) / 100
        else:
            take_profit_rate = None

        stop_loss_rate = data.get('stop_loss_rate')
        if stop_loss_rate is not None and stop_loss_rate != '':
            stop_loss_rate = float(stop_loss_rate) / 100
        else:
            stop_loss_rate = None

        if not all([fund_code, start_date, end_date]):
            return jsonify({'error': 'Missing required parameters'}), 400

        db = get_db()
        trend = db.query(FundTrend).filter(FundTrend.fund_code == fund_code).first()
        if not trend:
            return jsonify({'error': f'Fund data not found for code {fund_code}'}), 404

        net_worth_data = _json_loads(trend.net_worth_trend_json, [])
        if not net_worth_data:
            return jsonify({'error': 'No net worth data available'}), 404

        nav_dict = {}
        for item in net_worth_data:
            date_str = item.get('date')
            nav = item.get('net_worth')
            if date_str and nav is not None:
                try:
                    nav_dict[date_str] = float(nav)
                except (ValueError, TypeError):
                    continue

        sorted_dates = sorted(nav_dict.keys())
        if not sorted_dates:
            return jsonify({'error': 'Valid net worth data is empty'}), 404

        def parse_date(date_str):
            for fmt in ['%Y-%m-%d', '%Y/%m/%d', '%Y%m%d', '%Y-%m-%d %H:%M:%S']:
                try:
                    return datetime.strptime(date_str, fmt)
                except ValueError:
                    continue
            raise ValueError(f"Unknown date format: {date_str}")

        try:
            start_dt = parse_date(start_date).replace(hour=0, minute=0, second=0, microsecond=0)
            end_dt = parse_date(end_date).replace(hour=23, minute=59, second=59, microsecond=999999)
        except ValueError as e:
            return jsonify({'error': f'Invalid date format: {str(e)}'}), 400

        filtered_dates = []
        for d in sorted_dates:
            try:
                current_dt = datetime.strptime(d, '%Y-%m-%d')
                if start_dt <= current_dt <= end_dt:
                    filtered_dates.append(d)
            except ValueError:
                continue

        if len(filtered_dates) < 2:
            return jsonify({'error': f'Insufficient data in range {start_date} to {end_date}.'}), 400

        result = _run_backtest(
            nav_dict=nav_dict, dates=filtered_dates,
            investment_type=investment_type, amount=amount,
            initial_amount=initial_amount, fee_rate=fee_rate,
            take_profit_rate=take_profit_rate, stop_loss_rate=stop_loss_rate,
        )

        if 'error' in result:
            return jsonify(result), 400

        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Backtest execution failed: {str(e)}'}), 500
