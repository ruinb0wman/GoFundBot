import os

from flask import request
from flask_admin import Admin, BaseView, expose
from flask_admin.contrib.sqla import ModelView
from sqlalchemy import text
from sqlalchemy.orm import scoped_session

from database import DATABASE_PATH, SessionLocal
from models import (
    AlertRule,
    AnalysisMemory,
    ChatMessage,
    ChatSession,
    DailyMarketSummary,
    DataFetchTask,
    FundBasicInfo,
    FundEstimate,
    FundEtfTracking,
    FundExtraData,
    FundIndustryPerformance,
    FundIndustryTag,
    FundNavHistory,
    FundPortfolio,
    FundRiskMetrics,
    FundScreeningRank,
    FundTrend,
    FundWatchlist,
    FundWatchlistGroup,
    StockIndustry,
    UserFundGroupMap,
    UserFundPortfolio,
    UserPortfolioGroup,
    UserPosition,
    UserTradeRecord,
)

_SESSION = scoped_session(SessionLocal)

ALL_MODELS = [
    FundBasicInfo,
    FundTrend,
    FundEstimate,
    FundPortfolio,
    FundExtraData,
    FundRiskMetrics,
    FundScreeningRank,
    FundWatchlist,
    FundWatchlistGroup,
    DataFetchTask,
    FundNavHistory,
    StockIndustry,
    FundIndustryTag,
    FundIndustryPerformance,
    FundEtfTracking,
    AlertRule,
    DailyMarketSummary,
    UserFundPortfolio,
    UserTradeRecord,
    UserPosition,
    UserPortfolioGroup,
    UserFundGroupMap,
    ChatSession,
    ChatMessage,
    AnalysisMemory,
]

_JSON_COL_NAMES = frozenset(
    {
        "basic_json",
        "performance_json",
        "net_worth_trend_json",
        "accumulated_net_worth_json",
        "position_trend_json",
        "total_return_trend_json",
        "ranking_trend_json",
        "ranking_percentage_json",
        "scale_fluctuation_json",
        "holder_structure_json",
        "asset_allocation_json",
        "performance_evaluation_json",
        "fund_managers_json",
        "subscription_redemption_json",
        "same_type_funds_json",
        "stock_codes_json",
        "bond_codes_json",
        "stock_codes_new_json",
        "bond_codes_new_json",
        "detail_json",
        "options_json",
        "error_message",
        "concepts_json",
        "indices_json",
        "hot_sectors_json",
        "key_news_json",
        "fund_data_json",
    }
)


def _build_view_class(model):
    json_cols = [c.name for c in model.__table__.columns if c.name in _JSON_COL_NAMES or c.name.endswith("_json")]

    def _fmt(view, context, model, name):
        val = str(getattr(model, name, "") or "")
        return val[:120] + ("…" if len(val) > 120 else "")

    formatters = {col: _fmt for col in json_cols}
    return type(
        f"{model.__name__}View",
        (ModelView,),
        {
            "can_export": True,
            "export_max_rows": 2000,
            "page_size": 50,
            "can_set_page_size": True,
            "column_display_pk": False,
            "column_formatters": formatters,
        },
    )


class SQLQueryView(BaseView):
    @expose("/", methods=["GET", "POST"])
    def index(self):
        result = None
        columns = []
        error = None
        sql = ""
        if request.method == "POST":
            sql = request.form.get("sql", "").strip()
            if sql:
                db = _SESSION()
                try:
                    stmt = text(sql)
                    upper_sql = sql.upper().lstrip()
                    if upper_sql.startswith("SELECT") or upper_sql.startswith("WITH"):
                        rows = db.execute(stmt).fetchall()
                        columns = list(rows[0]._mapping.keys()) if rows else []
                        result = [dict(row._mapping) for row in rows]
                    else:
                        rp = db.execute(stmt)
                        db.commit()
                        affected = rp.rowcount
                        result = f"执行成功，影响 {affected} 行" if affected >= 0 else "执行成功"
                except Exception as exc:
                    error = str(exc)
                    db.rollback()
                finally:
                    db.close()
        return self.render(
            "sql_admin/sql.html",
            result=result,
            columns=columns,
            error=error,
            sql=sql,
        )


def create_admin(app):
    admin = Admin(
        app,
        name=f"SQLite 管理 — {DATABASE_PATH.name}",
        url="/sqlite-admin",
    )
    for model in ALL_MODELS:
        view_cls = _build_view_class(model)
        admin.add_view(view_cls(model, _SESSION))
    admin.add_view(SQLQueryView(name="SQL 查询", endpoint="sql-query"))
    return admin


def is_enabled(app):
    raw = os.environ.get("ENABLE_SQLITE_ADMIN", "").lower()
    if raw in ("false", "0"):
        return False
    if raw in ("true", "1"):
        return True
    if app.debug:
        return True
    return os.environ.get("FLASK_DEBUG", "").lower() in ("true", "1")
