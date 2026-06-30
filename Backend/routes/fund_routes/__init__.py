from flask import Blueprint

fund_bp = Blueprint("fund", __name__, url_prefix="")

from . import analyze, compare, detail, market, search  # noqa: E402
