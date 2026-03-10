"""SQLite database with WAL mode for concurrent read/write."""

import aiosqlite

from config import DB_PATH

_db: aiosqlite.Connection | None = None

# Use strftime for compatibility with SQLite < 3.38 (no unixepoch)
_TABLES = [
    """CREATE TABLE IF NOT EXISTS datasets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    )""",
    """CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        query TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'clear_en',
        constraints TEXT DEFAULT '{}',
        UNIQUE(dataset_id, key)
    )""",
    """CREATE TABLE IF NOT EXISTS experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset_id INTEGER NOT NULL REFERENCES datasets(id),
        tag TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        config TEXT DEFAULT '{}',
        summary TEXT DEFAULT '{}',
        created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
        finished_at REAL
    )""",
    """CREATE TABLE IF NOT EXISTS traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        case_key TEXT NOT NULL,
        trial_num INTEGER NOT NULL DEFAULT 1,
        query TEXT NOT NULL,
        case_type TEXT NOT NULL DEFAULT 'clear_en',
        status TEXT NOT NULL DEFAULT 'pending',
        duration_s REAL DEFAULT 0,
        guide_text TEXT DEFAULT '',
        products TEXT DEFAULT '[]',
        sources TEXT DEFAULT '[]',
        events TEXT DEFAULT '[]',
        hook_metrics TEXT DEFAULT '{}',
        error_events TEXT DEFAULT '[]',
        clarification TEXT,
        l0_scores TEXT DEFAULT '{}',
        l1_scores TEXT DEFAULT '{}',
        l2_scores TEXT,
        final_score REAL DEFAULT 0,
        final_pass INTEGER DEFAULT 0,
        created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_traces_experiment ON traces(experiment_id)",
    "CREATE INDEX IF NOT EXISTS idx_cases_dataset ON cases(dataset_id)",
]


async def init_db() -> None:
    """Initialize database connection and create tables."""
    global _db
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _db = await aiosqlite.connect(str(DB_PATH))
    _db.row_factory = aiosqlite.Row
    await _db.execute("PRAGMA journal_mode=WAL")
    await _db.execute("PRAGMA foreign_keys=ON")
    for sql in _TABLES:
        await _db.execute(sql)
    await _db.commit()


async def get_db() -> aiosqlite.Connection:
    """Get the shared database connection."""
    if _db is None:
        await init_db()
    return _db  # type: ignore
