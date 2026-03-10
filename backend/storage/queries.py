"""CRUD operations for eval platform storage."""

import json
from statistics import median

from storage.database import get_db
from storage.models import Dataset, Case, Experiment, Trace, ExperimentSummary


# ── Datasets ──────────────────────────────────────

async def create_dataset(name: str, description: str = "") -> int:
    db = await get_db()
    cursor = await db.execute(
        "INSERT INTO datasets (name, description) VALUES (?, ?)",
        (name, description),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore


async def list_datasets() -> list[Dataset]:
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT d.*, COUNT(c.id) as case_count
           FROM datasets d LEFT JOIN cases c ON c.dataset_id = d.id
           GROUP BY d.id ORDER BY d.created_at DESC"""
    )
    return [Dataset(id=r["id"], name=r["name"], description=r["description"],
                    case_count=r["case_count"], created_at=r["created_at"]) for r in rows]


async def get_dataset(dataset_id: int) -> Dataset | None:
    db = await get_db()
    row = await db.execute_fetchall(
        """SELECT d.*, COUNT(c.id) as case_count
           FROM datasets d LEFT JOIN cases c ON c.dataset_id = d.id
           WHERE d.id = ? GROUP BY d.id""",
        (dataset_id,),
    )
    if not row:
        return None
    r = row[0]
    return Dataset(id=r["id"], name=r["name"], description=r["description"],
                   case_count=r["case_count"], created_at=r["created_at"])


async def get_dataset_by_name(name: str) -> Dataset | None:
    db = await get_db()
    row = await db.execute_fetchall(
        """SELECT d.*, COUNT(c.id) as case_count
           FROM datasets d LEFT JOIN cases c ON c.dataset_id = d.id
           WHERE d.name = ? GROUP BY d.id""",
        (name,),
    )
    if not row:
        return None
    r = row[0]
    if r["id"] is None:
        return None
    return Dataset(id=r["id"], name=r["name"], description=r["description"],
                   case_count=r["case_count"], created_at=r["created_at"])


# ── Cases ─────────────────────────────────────────

async def upsert_case(dataset_id: int, key: str, query: str, case_type: str, constraints: dict | None = None) -> int:
    db = await get_db()
    constraints_json = json.dumps(constraints or {})
    cursor = await db.execute(
        """INSERT INTO cases (dataset_id, key, query, type, constraints)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(dataset_id, key) DO UPDATE SET
             query=excluded.query, type=excluded.type, constraints=excluded.constraints""",
        (dataset_id, key, query, case_type, constraints_json),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore


async def get_cases(dataset_id: int) -> list[Case]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM cases WHERE dataset_id = ? ORDER BY id",
        (dataset_id,),
    )
    return [Case(id=r["id"], dataset_id=r["dataset_id"], key=r["key"],
                 query=r["query"], type=r["type"],
                 constraints=json.loads(r["constraints"])) for r in rows]


# ── Experiments ───────────────────────────────────

async def create_experiment(dataset_id: int, tag: str = "", config: dict | None = None) -> int:
    db = await get_db()
    cursor = await db.execute(
        "INSERT INTO experiments (dataset_id, tag, config) VALUES (?, ?, ?)",
        (dataset_id, tag, json.dumps(config or {})),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore


async def get_experiment(experiment_id: int) -> Experiment | None:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM experiments WHERE id = ?", (experiment_id,),
    )
    if not rows:
        return None
    r = rows[0]
    return Experiment(
        id=r["id"], dataset_id=r["dataset_id"], tag=r["tag"],
        status=r["status"], config=json.loads(r["config"]),
        summary=json.loads(r["summary"]), created_at=r["created_at"],
        finished_at=r["finished_at"],
    )


async def update_experiment_status(experiment_id: int, status: str, summary: dict | None = None, finished_at: float | None = None):
    db = await get_db()
    if summary is not None:
        await db.execute(
            "UPDATE experiments SET status=?, summary=?, finished_at=? WHERE id=?",
            (status, json.dumps(summary), finished_at, experiment_id),
        )
    else:
        await db.execute(
            "UPDATE experiments SET status=? WHERE id=?",
            (status, experiment_id),
        )
    await db.commit()


async def list_experiments(limit: int = 50) -> list[Experiment]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM experiments ORDER BY created_at DESC LIMIT ?", (limit,),
    )
    return [Experiment(
        id=r["id"], dataset_id=r["dataset_id"], tag=r["tag"],
        status=r["status"], config=json.loads(r["config"]),
        summary=json.loads(r["summary"]), created_at=r["created_at"],
        finished_at=r["finished_at"],
    ) for r in rows]


# ── Traces ────────────────────────────────────────

async def create_trace(experiment_id: int, case_key: str, trial_num: int,
                       query: str, case_type: str) -> int:
    db = await get_db()
    cursor = await db.execute(
        """INSERT INTO traces (experiment_id, case_key, trial_num, query, case_type, status)
           VALUES (?, ?, ?, ?, ?, 'running')""",
        (experiment_id, case_key, trial_num, query, case_type),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore


async def update_trace(trace_id: int, **kwargs):
    db = await get_db()
    # Serialize complex fields to JSON
    json_fields = {"products", "sources", "events", "hook_metrics",
                   "error_events", "clarification", "l0_scores", "l1_scores", "l2_scores"}
    sets = []
    values = []
    for key, val in kwargs.items():
        if key in json_fields and not isinstance(val, str):
            val = json.dumps(val)
        sets.append(f"{key}=?")
        values.append(val)
    values.append(trace_id)
    await db.execute(f"UPDATE traces SET {', '.join(sets)} WHERE id=?", values)
    await db.commit()


async def get_trace(trace_id: int) -> Trace | None:
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM traces WHERE id=?", (trace_id,))
    if not rows:
        return None
    return _row_to_trace(rows[0])


async def get_experiment_traces(experiment_id: int) -> list[Trace]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM traces WHERE experiment_id=? ORDER BY case_key, trial_num",
        (experiment_id,),
    )
    return [_row_to_trace(r) for r in rows]


def _row_to_trace(r) -> Trace:
    def _parse(val, default):
        if val is None:
            return default
        if isinstance(val, str):
            try:
                return json.loads(val)
            except (json.JSONDecodeError, ValueError):
                return default
        return val

    return Trace(
        id=r["id"], experiment_id=r["experiment_id"],
        case_key=r["case_key"], trial_num=r["trial_num"],
        query=r["query"], case_type=r["case_type"],
        status=r["status"], duration_s=r["duration_s"] or 0,
        guide_text=r["guide_text"] or "",
        products=_parse(r["products"], []),
        sources=_parse(r["sources"], []),
        events=_parse(r["events"], []),
        hook_metrics=_parse(r["hook_metrics"], {}),
        error_events=_parse(r["error_events"], []),
        clarification=_parse(r["clarification"], None),
        l0_scores=_parse(r["l0_scores"], {}),
        l1_scores=_parse(r["l1_scores"], {}),
        l2_scores=_parse(r["l2_scores"], None),
        final_score=r["final_score"] or 0,
        final_pass=bool(r["final_pass"]),
        created_at=r["created_at"] or 0,
    )


async def compute_experiment_summary(experiment_id: int) -> ExperimentSummary:
    traces = await get_experiment_traces(experiment_id)
    completed = [t for t in traces if t.status == "done"]
    scores = [t.final_score for t in completed]
    passed = sum(1 for t in completed if t.final_pass)
    errored = sum(1 for t in traces if t.status == "error")
    durations = [t.duration_s for t in completed if t.duration_s > 0]

    return ExperimentSummary(
        total_cases=len(traces),
        completed=len(completed),
        passed=passed,
        failed=len(completed) - passed,
        errored=errored,
        avg_score=round(sum(scores) / len(scores), 1) if scores else 0,
        median_score=round(median(scores), 1) if scores else 0,
        avg_duration=round(sum(durations) / len(durations), 1) if durations else 0,
    )
