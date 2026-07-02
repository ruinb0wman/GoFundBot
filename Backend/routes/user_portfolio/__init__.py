from flask import Blueprint

user_portfolio_bp = Blueprint("user_portfolio_bp", __name__, url_prefix="/api/user/portfolio")

# Import sub-modules to trigger route registration
from . import funds, groups, migration, trades  # noqa: F401, E402
