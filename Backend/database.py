import shutil
import threading
import time
from contextlib import suppress
from datetime import datetime
from pathlib import Path

from flask import g
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from core.logging import get_logger
from models import Base

logger = get_logger(__name__)

# 获取当前文件所在目录（Backend/）
BACKEND_DIR = Path(__file__).parent.resolve()
# 项目根目录 = BACKEND_DIR 的父目录
PROJECT_ROOT = BACKEND_DIR
# 数据库路径：PROJECT_ROOT / Data / funds.db
DATABASE_PATH = PROJECT_ROOT / "Data" / "funds.db"
DATABASE_BACKUP_DIR = PROJECT_ROOT / "Data" / "backups"

# 构造 SQLite URL
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

_WAL_CHECKPOINT_INTERVAL = 1800  # 30 分钟


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def checkpoint_wal():
    """强制执行 WAL checkpoint (TRUNCATE)，将已提交数据写入主数据库文件。"""
    try:
        with engine.connect() as conn:
            conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
            conn.commit()
        logger.debug("WAL checkpoint 完成")
    except Exception as e:
        logger.warning(f"WAL checkpoint 失败: {e}")


def create_backup():
    """启动前创建数据库快照备份，保留最近 7 份。"""
    if not DATABASE_PATH.exists():
        logger.info("数据库文件不存在，跳过备份")
        return False

    DATABASE_BACKUP_DIR.mkdir(exist_ok=True)
    checkpoint_wal()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = DATABASE_BACKUP_DIR / f"funds_{ts}.db"

    try:
        shutil.copy2(DATABASE_PATH, backup_path)
        logger.info(f"数据库备份已创建: {backup_path.name}")
    except Exception as e:
        logger.warning(f"数据库备份失败: {e}")
        return False

    backups = sorted(DATABASE_BACKUP_DIR.glob("funds_*.db"))
    while len(backups) > 7:
        old = backups.pop(0)
        try:
            old.unlink()
        except Exception as e:
            logger.warning(f"删除旧备份失败 {old.name}: {e}")
    return True


def log_table_stats():
    """记录各表行数，便于排查数据丢失。"""
    from sqlalchemy import inspect as sa_inspect

    try:
        inspector = sa_inspect(engine)
        table_names = inspector.get_table_names()
        stats = []
        with engine.connect() as conn:
            for table in sorted(table_names):
                try:
                    result = conn.execute(text(f"SELECT COUNT(*) FROM [{table}]"))
                    count = result.scalar() or 0
                    stats.append(f"{table}={count}")
                except Exception:
                    stats.append(f"{table}=ERR")
        logger.info(f"数据库行数统计: [{', '.join(stats)}]")
    except Exception as e:
        logger.warning(f"数据库行数统计失败: {e}")


def shutdown_db():
    """关闭时 checkpoint + dispose + 清理 WAL/SHM 残留。"""
    checkpoint_wal()
    try:
        engine.dispose()
        logger.info("数据库引擎已关闭")
    except Exception as e:
        logger.warning(f"关闭数据库引擎失败: {e}")
    for suffix in (".db-shm", ".db-wal"):
        f = DATABASE_PATH.with_suffix(suffix)
        if f.exists():
            with suppress(OSError):
                f.unlink()


def _periodic_checkpoint_loop():
    while True:
        time.sleep(_WAL_CHECKPOINT_INTERVAL)
        checkpoint_wal()


def start_periodic_checkpoint():
    t = threading.Thread(target=_periodic_checkpoint_loop, daemon=True, name="wal-checkpoint")
    t.start()
    logger.info("WAL 定期检查点已启动（每 30 分钟）")


def migrate_db():
    """数据库迁移：为现有表添加缺失的列"""
    with engine.connect() as conn:
        # 检查并添加 fund_watchlist.group_id 列
        try:
            result = conn.execute(text("PRAGMA table_info(fund_watchlist)"))
            columns = [row[1] for row in result.fetchall()]
            if "group_id" not in columns:
                conn.execute(text("ALTER TABLE fund_watchlist ADD COLUMN group_id INTEGER DEFAULT NULL"))
                conn.commit()
                logger.info("Migration: Added group_id column to fund_watchlist table")
        except Exception as e:
            logger.warning(f"Migration check for fund_watchlist: {e}")

        # 检查并添加 daily_market_summary 表的新列
        try:
            result = conn.execute(text("PRAGMA table_info(daily_market_summary)"))
            columns = [row[1] for row in result.fetchall()]
            if "current_step" not in columns:
                conn.execute(text("ALTER TABLE daily_market_summary ADD COLUMN current_step INTEGER DEFAULT 0"))
                conn.commit()
                logger.info("Migration: Added current_step column to daily_market_summary table")
            if "step_message" not in columns:
                conn.execute(text("ALTER TABLE daily_market_summary ADD COLUMN step_message VARCHAR(200)"))
                conn.commit()
                logger.info("Migration: Added step_message column to daily_market_summary table")
        except Exception as e:
            logger.warning(f"Migration check for daily_market_summary: {e}")

        # Screening no longer persists full NAV history; risk metrics are stored in fund_risk_metrics.
        try:
            result = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='fund_nav_history'"))
            if result.fetchone():
                count_result = conn.execute(text("SELECT COUNT(*) FROM fund_nav_history"))
                row_count = count_result.scalar() or 0
                if row_count > 0:
                    conn.execute(text("DELETE FROM fund_nav_history"))
                    conn.commit()
                    logger.info(f"Migration: Cleared {row_count} rows from fund_nav_history")
        except Exception as e:
            logger.warning(f"Migration cleanup for fund_nav_history: {e}")


def _check_integrity():
    """运行 SQLite integrity_check 并记录结果。"""
    try:
        with engine.connect() as conn:
            result = conn.execute(text("PRAGMA integrity_check"))
            rows = result.fetchall()
            if len(rows) == 1 and rows[0][0] == "ok":
                logger.info("数据库完整性检查通过")
            else:
                logger.warning(f"数据库完整性检查异常: {rows}")
    except Exception as e:
        logger.warning(f"数据库完整性检查失败: {e}")


def _recover_stale_wal():
    """检测上次非正常退出留下的 WAL/SHM 文件，尝试 checkopoint 恢复。"""
    wal = DATABASE_PATH.with_suffix(".db-wal")
    shm = DATABASE_PATH.with_suffix(".db-shm")
    if not wal.exists() and not shm.exists():
        return
    logger.warning("检测到非正常退出残留的 WAL/SHM 文件，尝试恢复...")
    try:
        with engine.connect() as conn:
            conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
            conn.commit()
        logger.info("WAL 恢复成功")
    except Exception as e:
        logger.error(f"WAL 恢复失败 ({e})，已损坏，请手动从备份恢复")
        raise RuntimeError("数据库文件损坏，无法自动恢复。检查 backups/ 目录中的备份文件。")


def init_db():
    # 确保 Data 目录存在
    (PROJECT_ROOT / "Data").mkdir(exist_ok=True)

    # 启动前检测并恢复残留 WAL（防止上一次崩溃导致数据丢失）
    _recover_stale_wal()

    # 启动前创建备份（先 checkpoint 保证一致性）
    create_backup()

    # 创建所有表（新表会被创建，已有表不会被覆盖）
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("数据库表创建/校验完成")
    except Exception as e:
        logger.error(f"数据库表创建失败: {e}", exc_info=True)
        raise

    # 验证表是否都已创建
    from sqlalchemy import inspect

    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    expected = set(Base.metadata.tables.keys())
    missing = expected - existing
    if missing:
        logger.error(f"数据库缺少以下表: {sorted(missing)}")
        raise RuntimeError(f"数据库初始化不完整，缺少表: {sorted(missing)}")
    logger.info(f"数据库表验证通过 ({len(existing)} 张表)")

    # 执行数据库迁移
    migrate_db()

    # 完整性检查 + 行数统计
    _check_integrity()
    log_table_stats()
    start_periodic_checkpoint()


def get_request_db() -> Session:
    """获取 Flask 请求作用域内的数据库会话（通过 g 缓存，teardown 自动关闭）"""
    if "db" not in g:
        g.db = SessionLocal()
    return g.db


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
