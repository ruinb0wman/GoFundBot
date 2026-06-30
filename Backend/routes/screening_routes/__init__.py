from flask import Blueprint

screening_bp = Blueprint("screening", __name__, url_prefix="/api/screening")

from . import industry, query, tasks  # noqa: E402, F401
