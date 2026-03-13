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
        golden_data TEXT DEFAULT '{}',
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
        composite_scores TEXT DEFAULT '{}',
        failure_funnel TEXT DEFAULT '{}',
        error_types TEXT DEFAULT '[]',
        grading_duration_s REAL DEFAULT 0,
        created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_traces_experiment ON traces(experiment_id)",
    "CREATE INDEX IF NOT EXISTS idx_cases_dataset ON cases(dataset_id)",
]

# Migrations for existing databases (run after table creation)
_MIGRATIONS = [
    # Add golden_data to cases
    "ALTER TABLE cases ADD COLUMN golden_data TEXT DEFAULT '{}'",
    # Add new grading columns to traces
    "ALTER TABLE traces ADD COLUMN composite_scores TEXT DEFAULT '{}'",
    "ALTER TABLE traces ADD COLUMN failure_funnel TEXT DEFAULT '{}'",
    "ALTER TABLE traces ADD COLUMN error_types TEXT DEFAULT '[]'",
    "ALTER TABLE traces ADD COLUMN grading_duration_s REAL DEFAULT 0",
    # Phase 2: suite_type on datasets (capability / regression)
    "ALTER TABLE datasets ADD COLUMN suite_type TEXT DEFAULT 'capability'",
    # Phase 2: reference_output on cases (known-good output for grader calibration)
    "ALTER TABLE cases ADD COLUMN reference_output TEXT",
    # Phase 2: human_scores on traces (human annotation for LLM-judge calibration)
    "ALTER TABLE traces ADD COLUMN human_scores TEXT DEFAULT '{}'",
    # Phase 2: grading_log on traces (per-grader execution log)
    "ALTER TABLE traces ADD COLUMN grading_log TEXT DEFAULT '[]'",
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
    # Run migrations (safe: ALTER TABLE ADD COLUMN is no-op if column exists)
    for sql in _MIGRATIONS:
        try:
            await _db.execute(sql)
        except Exception:
            pass  # Column already exists
    await _db.commit()


async def get_db() -> aiosqlite.Connection:
    """Get the shared database connection."""
    if _db is None:
        await init_db()
    return _db  # type: ignore
