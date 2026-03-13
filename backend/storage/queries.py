"""CRUD operations for eval platform storage."""

import json
from collections import defaultdict
from statistics import median, stdev

from storage.database import get_db
from storage.models import Dataset, Case, Experiment, Trace, ExperimentSummary


# ── Datasets ──────────────────────────────────────

async def create_dataset(name: str, description: str = "", suite_type: str = "capability") -> int:
    db = await get_db()
    cursor = await db.execute(
        "INSERT INTO datasets (name, description, suite_type) VALUES (?, ?, ?)",
        (name, description, suite_type),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore


async def update_dataset(dataset_id: int, **kwargs) -> None:
    db = await get_db()
    sets = []
    values = []
    for key, val in kwargs.items():
        sets.append(f"{key}=?")
        values.append(val)
    values.append(dataset_id)
    await db.execute(f"UPDATE datasets SET {', '.join(sets)} WHERE id=?", values)
    await db.commit()


def _safe_suite_type(r) -> str:
    try:
        return r["suite_type"] or "capability"
    except (IndexError, KeyError):
        return "capability"


async def list_datasets() -> list[Dataset]:
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT d.*, COUNT(c.id) as case_count
           FROM datasets d LEFT JOIN cases c ON c.dataset_id = d.id
           GROUP BY d.id ORDER BY d.created_at DESC"""
    )
    return [Dataset(id=r["id"], name=r["name"], description=r["description"],
                    suite_type=_safe_suite_type(r),
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
                   suite_type=_safe_suite_type(r),
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
                   suite_type=_safe_suite_type(r),
                   case_count=r["case_count"], created_at=r["created_at"])


# ── Cases ─────────────────────────────────────────

async def upsert_case(
    dataset_id: int,
    key: str,
    query: str,
    case_type: str,
    constraints: dict | None = None,
    golden_data: dict | None = None,
    reference_output: dict | None = None,
) -> int:
    db = await get_db()
    constraints_json = json.dumps(constraints or {})
    golden_data_json = json.dumps(golden_data or {})
    ref_json = json.dumps(reference_output) if reference_output else None
    cursor = await db.execute(
        """INSERT INTO cases (dataset_id, key, query, type, constraints, golden_data, reference_output)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(dataset_id, key) DO UPDATE SET
             query=excluded.query, type=excluded.type,
             constraints=excluded.constraints, golden_data=excluded.golden_data,
             reference_output=excluded.reference_output""",
        (dataset_id, key, query, case_type, constraints_json, golden_data_json, ref_json),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore


async def get_cases(dataset_id: int) -> list[Case]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM cases WHERE dataset_id = ? ORDER BY id",
        (dataset_id,),
    )
    return [_row_to_case(r) for r in rows]


async def get_case_by_key(dataset_id: int, key: str) -> Case | None:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM cases WHERE dataset_id = ? AND key = ?",
        (dataset_id, key),
    )
    if not rows:
        return None
    return _row_to_case(rows[0])


def _row_to_case(r) -> Case:
    golden_data_raw = r["golden_data"] if "golden_data" in r.keys() else "{}"
    try:
        golden_data = json.loads(golden_data_raw) if golden_data_raw else {}
    except (json.JSONDecodeError, TypeError):
        golden_data = {}

    ref_raw = None
    try:
        ref_raw = r["reference_output"]
    except (IndexError, KeyError):
        pass
    try:
        reference_output = json.loads(ref_raw) if ref_raw else None
    except (json.JSONDecodeError, TypeError):
        reference_output = None

    return Case(
        id=r["id"], dataset_id=r["dataset_id"], key=r["key"],
        query=r["query"], type=r["type"],
        constraints=json.loads(r["constraints"]),
        golden_data=golden_data,
        reference_output=reference_output,
    )


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
                   "error_events", "clarification", "l0_scores", "l1_scores", "l2_scores",
                   "composite_scores", "failure_funnel", "error_types",
                   "human_scores", "grading_log"}
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


async def get_collected_traces(experiment_id: int) -> list[Trace]:
    """Get traces that have been collected but may need (re)grading."""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM traces WHERE experiment_id=? AND status IN ('collected', 'done', 'graded') ORDER BY id",
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

    # Handle columns that may not exist in older databases
    def _safe_get(row, key, default):
        try:
            return row[key]
        except (IndexError, KeyError):
            return default

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
        composite_scores=_parse(_safe_get(r, "composite_scores", "{}"), {}),
        failure_funnel=_parse(_safe_get(r, "failure_funnel", "{}"), {}),
        error_types=_parse(_safe_get(r, "error_types", "[]"), []),
        grading_duration_s=_safe_get(r, "grading_duration_s", 0) or 0,
        human_scores=_parse(_safe_get(r, "human_scores", "{}"), {}),
        grading_log=_parse(_safe_get(r, "grading_log", "[]"), []),
        created_at=r["created_at"] or 0,
    )


async def compute_experiment_summary(experiment_id: int) -> ExperimentSummary:
    traces = await get_experiment_traces(experiment_id)
    completed = [t for t in traces if t.status in ("done", "graded", "collected")]
    scores = [t.final_score for t in completed]
    passed = sum(1 for t in completed if t.final_pass)
    errored = sum(1 for t in traces if t.status == "error")
    durations = [t.duration_s for t in completed if t.duration_s > 0]

    # pass@k and pass^k (grouped by case_key)
    case_trials: dict[str, list[Trace]] = defaultdict(list)
    for t in completed:
        case_trials[t.case_key].append(t)

    pass_at_1_count = 0  # cases where at least 1 trial passed
    pass_all_count = 0   # cases where ALL trials passed
    consistency_scores: list[float] = []

    for case_key, trials in case_trials.items():
        trial_passes = [t.final_pass for t in trials]
        trial_scores = [t.final_score for t in trials]
        if any(trial_passes):
            pass_at_1_count += 1
        if all(trial_passes):
            pass_all_count += 1
        if len(trial_scores) >= 2:
            consistency_scores.append(stdev(trial_scores))

    total_cases_unique = len(case_trials) if case_trials else 1

    # Failure funnel distribution
    funnel_dist: dict[str, int] = {}
    for t in completed:
        if t.failure_funnel and t.failure_funnel.get("stage"):
            stage = t.failure_funnel["stage"]
            funnel_dist[stage] = funnel_dist.get(stage, 0) + 1

    # Per-grader averages
    grader_sums: dict[str, list[float]] = defaultdict(list)
    for t in completed:
        if t.composite_scores:
            for grader_name, data in t.composite_scores.items():
                if isinstance(data, dict) and data.get("score") is not None:
                    grader_sums[grader_name].append(data["score"])
    grader_averages = {
        name: round(sum(vals) / len(vals), 1)
        for name, vals in grader_sums.items() if vals
    }

    # pass@k for multiple k values
    pass_at_k: dict[str, float] = {}
    n_trials = max((len(ts) for ts in case_trials.values()), default=1)
    for k in [1, 2, 3, 5, 10]:
        if k > n_trials:
            break
        count = 0
        for case_key, trials in case_trials.items():
            passes = [t.final_pass for t in trials[:k]]
            if any(passes):
                count += 1
        pass_at_k[f"pass@{k}"] = round(count / total_cases_unique, 3)

    # pass^k for multiple k values
    pass_pow_k: dict[str, float] = {}
    for k in [1, 2, 3, 5]:
        if k > n_trials:
            break
        count = 0
        for case_key, trials in case_trials.items():
            passes = [t.final_pass for t in trials[:k]]
            if all(passes):
                count += 1
        pass_pow_k[f"pass^{k}"] = round(count / total_cases_unique, 3)

    return ExperimentSummary(
        total_cases=len(traces),
        completed=len(completed),
        passed=passed,
        failed=len(completed) - passed,
        errored=errored,
        avg_score=round(sum(scores) / len(scores), 1) if scores else 0,
        median_score=round(median(scores), 1) if scores else 0,
        avg_duration=round(sum(durations) / len(durations), 1) if durations else 0,
        pass_rate=round(pass_at_1_count / total_cases_unique, 3) if case_trials else 0,
        pass_all_rate=round(pass_all_count / total_cases_unique, 3) if case_trials else 0,
        consistency_rate=round(sum(consistency_scores) / len(consistency_scores), 1) if consistency_scores else 0,
        failure_funnel_dist=funnel_dist,
        grader_averages=grader_averages,
        pass_at_k=pass_at_k,
        pass_pow_k=pass_pow_k,
    )


# ── Human Annotation ────────────────────────────

async def annotate_trace(trace_id: int, grader_name: str, human_score: float,
                         human_reasoning: str = "") -> None:
    """Save human annotation for a specific grader on a trace."""
    trace = await get_trace(trace_id)
    if not trace:
        return
    scores = dict(trace.human_scores)
    scores[grader_name] = {
        "score": human_score,
        "reasoning": human_reasoning,
    }
    await update_trace(trace_id, human_scores=scores)


# ── Case History (Saturation Tracking) ──────────

async def get_case_history(case_key: str, dataset_id: int | None = None) -> list[dict]:
    """Get score history for a case across experiments (for saturation tracking)."""
    db = await get_db()
    if dataset_id:
        rows = await db.execute_fetchall(
            """SELECT t.case_key, t.final_score, t.final_pass, t.trial_num,
                      e.id as experiment_id, e.tag, e.created_at as exp_created
               FROM traces t
               JOIN experiments e ON t.experiment_id = e.id
               WHERE t.case_key = ? AND e.dataset_id = ? AND t.status IN ('done', 'graded')
               ORDER BY e.created_at, t.trial_num""",
            (case_key, dataset_id),
        )
    else:
        rows = await db.execute_fetchall(
            """SELECT t.case_key, t.final_score, t.final_pass, t.trial_num,
                      e.id as experiment_id, e.tag, e.created_at as exp_created
               FROM traces t
               JOIN experiments e ON t.experiment_id = e.id
               WHERE t.case_key = ? AND t.status IN ('done', 'graded')
               ORDER BY e.created_at, t.trial_num""",
            (case_key,),
        )
    return [dict(r) for r in rows]


async def get_saturation_summary(dataset_id: int) -> list[dict]:
    """Get per-case pass rate across all experiments for saturation monitoring."""
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT t.case_key,
                  COUNT(*) as total_trials,
                  SUM(CASE WHEN t.final_pass THEN 1 ELSE 0 END) as passes,
                  AVG(t.final_score) as avg_score,
                  COUNT(DISTINCT e.id) as n_experiments
           FROM traces t
           JOIN experiments e ON t.experiment_id = e.id
           WHERE e.dataset_id = ? AND t.status IN ('done', 'graded')
           GROUP BY t.case_key
           ORDER BY avg_score ASC""",
        (dataset_id,),
    )
    result = []
    for r in rows:
        total = r["total_trials"]
        passes = r["passes"]
        result.append({
            "case_key": r["case_key"],
            "total_trials": total,
            "passes": passes,
            "pass_rate": round(passes / total, 3) if total else 0,
            "avg_score": round(r["avg_score"], 1) if r["avg_score"] else 0,
            "n_experiments": r["n_experiments"],
            "saturated": passes == total and total >= 3,  # 100% pass with 3+ trials
        })
    return result
