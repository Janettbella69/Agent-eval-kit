"""CRUD operations for eval platform storage."""

import json
import time
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

    # last_validated_at (migration-safe)
    try:
        last_validated_at = r["last_validated_at"] or 0
    except (IndexError, KeyError):
        last_validated_at = 0

    return Case(
        id=r["id"], dataset_id=r["dataset_id"], key=r["key"],
        query=r["query"], type=r["type"],
        constraints=json.loads(r["constraints"]),
        golden_data=golden_data,
        reference_output=reference_output,
        last_validated_at=last_validated_at,
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
                   "human_scores", "grading_log", "tool_names", "judge_prompts"}
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
        prompt_version=_safe_get(r, "prompt_version", "") or "",
        model=_safe_get(r, "model", "") or "",
        judge_prompt_version=_safe_get(r, "judge_prompt_version", "") or "",
        human_pass=bool(_safe_get(r, "human_pass", None)) if _safe_get(r, "human_pass", None) is not None else None,
        input_tokens=_safe_get(r, "input_tokens", 0) or 0,
        output_tokens=_safe_get(r, "output_tokens", 0) or 0,
        turn_count=_safe_get(r, "turn_count", 0) or 0,
        system_prompt=_safe_get(r, "system_prompt", "") or "",
        tool_names=_parse(_safe_get(r, "tool_names", "[]"), []),
        judge_prompts=_parse(_safe_get(r, "judge_prompts", "{}"), {}),
        open_codes=_parse(_safe_get(r, "open_codes", "[]"), []),
        review_status=_safe_get(r, "review_status", "pending") or "pending",
        reviewed_at=_safe_get(r, "reviewed_at", None),
        review_notes=_safe_get(r, "review_notes", "") or "",
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

    # Tracked metrics: turns, tokens, toolcalls
    turns = [t.turn_count for t in completed if t.turn_count > 0]
    tokens = [t.input_tokens + t.output_tokens for t in completed if t.input_tokens + t.output_tokens > 0]
    toolcalls = [len(t.tool_names) for t in completed]

    return ExperimentSummary(
        total_cases=len(traces),
        completed=len(completed),
        passed=passed,
        failed=len(completed) - passed,
        errored=errored,
        avg_score=round(sum(scores) / len(scores), 1) if scores else 0,
        median_score=round(median(scores), 1) if scores else 0,
        avg_duration=round(sum(durations) / len(durations), 1) if durations else 0,
        avg_turns=round(sum(turns) / len(turns), 1) if turns else 0,
        avg_tokens=round(sum(tokens) / len(tokens), 0) if tokens else 0,
        avg_toolcalls=round(sum(toolcalls) / len(toolcalls), 1) if toolcalls else 0,
        pass_rate=round(pass_at_1_count / total_cases_unique, 3) if case_trials else 0,
        pass_all_rate=round(pass_all_count / total_cases_unique, 3) if case_trials else 0,
        consistency_rate=round(sum(consistency_scores) / len(consistency_scores), 1) if consistency_scores else 0,
        failure_funnel_dist=funnel_dist,
        grader_averages=grader_averages,
        pass_at_k=pass_at_k,
        pass_pow_k=pass_pow_k,
    )


# ── Judge Alignment (TPR/TNR) ─────────────────

async def compute_judge_alignment() -> dict:
    """Compute TPR/TNR of auto grading vs human PASS/FAIL labels.

    Uses Rogan-Gladen formula to correct observed pass rate for judge bias.
    """
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT final_pass, human_pass
           FROM traces
           WHERE human_pass IS NOT NULL AND status IN ('done', 'graded')"""
    )
    if not rows:
        return {"total_labeled": 0}

    tp = fp = tn = fn = 0
    for r in rows:
        human = bool(r["human_pass"])
        auto = bool(r["final_pass"])
        if human and auto:
            tp += 1
        elif human and not auto:
            fn += 1
        elif not human and auto:
            fp += 1
        else:
            tn += 1

    tpr = tp / (tp + fn) if (tp + fn) > 0 else None
    tnr = tn / (tn + fp) if (tn + fp) > 0 else None

    # Rogan-Gladen bias correction on ALL traces
    corrected_pass_rate = None
    total_all = 0
    passed_all = 0
    if tpr is not None and tnr is not None:
        denom = tpr + tnr - 1
        if abs(denom) > 1e-6:
            all_rows = await db.execute_fetchall(
                """SELECT COUNT(*) as total,
                          SUM(CASE WHEN final_pass THEN 1 ELSE 0 END) as passed
                   FROM traces WHERE status IN ('done', 'graded')"""
            )
            if all_rows and all_rows[0]["total"] > 0:
                total_all = all_rows[0]["total"]
                passed_all = all_rows[0]["passed"]
                p_obs = passed_all / total_all
                corrected = (p_obs + tnr - 1) / denom
                corrected_pass_rate = max(0.0, min(1.0, corrected))

    return {
        "total_labeled": len(rows),
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "tpr": round(tpr, 3) if tpr is not None else None,
        "tnr": round(tnr, 3) if tnr is not None else None,
        "human_pass_rate": round((tp + fn) / len(rows), 3),
        "auto_pass_rate": round((tp + fp) / len(rows), 3),
        "total_traces": total_all,
        "observed_pass_rate": round(passed_all / total_all, 3) if total_all else None,
        "corrected_pass_rate": round(corrected_pass_rate, 3) if corrected_pass_rate is not None else None,
    }


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


async def annotate_trace_human_pass(trace_id: int, passed: bool) -> None:
    """Save human PASS/FAIL verdict for a trace."""
    await update_trace(trace_id, human_pass=int(passed))


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


async def compare_experiments(base_id: int, target_id: int) -> dict:
    """Compare two experiments case-by-case.

    For each case_key present in either experiment, computes the average score
    across trials and classifies the delta as improved/regressed/unchanged.

    Returns:
        {
            "base": {"id", "tag", "avg_score", "pass_rate"},
            "target": {"id", "tag", "avg_score", "pass_rate"},
            "cases": [{"case_key", "base_score", "target_score", "delta",
                        "base_pass", "target_pass", "status"}],
            "summary": {"improved", "regressed", "unchanged", "new", "removed",
                         "net_delta", "base_avg", "target_avg"}
        }
    """
    REGRESSION_THRESHOLD = 5  # score points

    db = await get_db()

    # Fetch average scores per case_key for each experiment
    async def _case_avgs(exp_id: int) -> dict[str, dict]:
        rows = await db.execute_fetchall(
            """SELECT case_key, query, case_type,
                      AVG(final_score) as avg_score,
                      MAX(final_pass) as any_pass,
                      COUNT(*) as n_trials
               FROM traces
               WHERE experiment_id = ? AND status IN ('done', 'graded', 'collected')
               GROUP BY case_key""",
            (exp_id,),
        )
        return {
            r["case_key"]: {
                "score": round(r["avg_score"], 2) if r["avg_score"] else 0,
                "pass": bool(r["any_pass"]),
                "query": r["query"],
                "case_type": r["case_type"],
                "n_trials": r["n_trials"],
            }
            for r in rows
        }

    base_avgs = await _case_avgs(base_id)
    target_avgs = await _case_avgs(target_id)

    all_keys = sorted(set(base_avgs.keys()) | set(target_avgs.keys()))

    cases = []
    improved = regressed = unchanged = new_cases = removed = 0
    base_scores = []
    target_scores = []

    for key in all_keys:
        b = base_avgs.get(key)
        t = target_avgs.get(key)

        if b and t:
            delta = round(t["score"] - b["score"], 2)
            if delta > REGRESSION_THRESHOLD:
                status = "improved"
                improved += 1
            elif delta < -REGRESSION_THRESHOLD:
                status = "regressed"
                regressed += 1
            else:
                status = "unchanged"
                unchanged += 1
            base_scores.append(b["score"])
            target_scores.append(t["score"])
        elif t and not b:
            delta = None
            status = "new"
            new_cases += 1
            target_scores.append(t["score"])
        else:
            delta = None
            status = "removed"
            removed += 1
            base_scores.append(b["score"])  # type: ignore

        cases.append({
            "case_key": key,
            "query": (t or b or {}).get("query", ""),
            "case_type": (t or b or {}).get("case_type", ""),
            "base_score": b["score"] if b else None,
            "target_score": t["score"] if t else None,
            "delta": delta,
            "base_pass": b["pass"] if b else None,
            "target_pass": t["pass"] if t else None,
            "status": status,
        })

    # Sort: regressed first, then by delta ascending
    status_order = {"regressed": 0, "new": 1, "unchanged": 2, "improved": 3, "removed": 4}
    cases.sort(key=lambda c: (status_order.get(c["status"], 9), c.get("delta") or 0))

    # Fetch experiment tags
    base_exp = await get_experiment(base_id)
    target_exp = await get_experiment(target_id)

    base_avg = round(sum(base_scores) / len(base_scores), 2) if base_scores else 0
    target_avg = round(sum(target_scores) / len(target_scores), 2) if target_scores else 0

    return {
        "base": {
            "id": base_id,
            "tag": base_exp.tag if base_exp else "",
            "avg_score": base_avg,
            "pass_rate": round(sum(1 for c in cases if c.get("base_pass")) / max(len(base_avgs), 1), 3),
        },
        "target": {
            "id": target_id,
            "tag": target_exp.tag if target_exp else "",
            "avg_score": target_avg,
            "pass_rate": round(sum(1 for c in cases if c.get("target_pass")) / max(len(target_avgs), 1), 3),
        },
        "cases": cases,
        "summary": {
            "improved": improved,
            "regressed": regressed,
            "unchanged": unchanged,
            "new": new_cases,
            "removed": removed,
            "net_delta": round(target_avg - base_avg, 2),
            "base_avg": base_avg,
            "target_avg": target_avg,
        },
    }


async def create_dataset_from_experiment(
    experiment_id: int,
    name: str,
    filter_type: str = "failed",
    compare_to: int | None = None,
    description: str = "",
) -> dict:
    """Create a debug dataset from experiment results.

    Args:
        experiment_id: Source experiment.
        name: New dataset name.
        filter_type: "failed" | "passed" | "regressed" | "improved"
        compare_to: Required for "regressed"/"improved" — the base experiment to compare against.
        description: Optional description.

    Returns:
        {"dataset_id": int, "cases_count": int, "filter": str}
    """
    experiment = await get_experiment(experiment_id)
    if not experiment:
        return {"error": "Experiment not found"}

    # Get all original cases from the dataset
    all_cases = await get_cases(experiment.dataset_id)
    case_map = {c.key: c for c in all_cases}

    if filter_type in ("regressed", "improved") and compare_to:
        # Compare-based filtering
        comparison = await compare_experiments(compare_to, experiment_id)
        target_status = filter_type  # "regressed" or "improved"
        selected_keys = [c["case_key"] for c in comparison["cases"] if c["status"] == target_status]
    else:
        # Single-experiment filtering
        traces = await get_experiment_traces(experiment_id)

        # Group by case_key, use best trial result
        case_results: dict[str, bool] = {}
        for t in traces:
            if t.status not in ("done", "graded", "collected"):
                continue
            key = t.case_key
            if filter_type == "failed":
                # Case is "failed" if no trial passed
                if key not in case_results:
                    case_results[key] = False
                if t.final_pass:
                    case_results[key] = True
            elif filter_type == "passed":
                if key not in case_results:
                    case_results[key] = False
                if t.final_pass:
                    case_results[key] = True

        if filter_type == "failed":
            selected_keys = [k for k, passed in case_results.items() if not passed]
        elif filter_type == "passed":
            selected_keys = [k for k, passed in case_results.items() if passed]
        else:
            selected_keys = list(case_results.keys())

    # Create new dataset with selected cases
    if not description:
        description = f"Debug dataset from experiment #{experiment_id} (filter: {filter_type})"

    dataset_id = await create_dataset(name, description, "regression")

    count = 0
    for key in selected_keys:
        case = case_map.get(key)
        if case:
            await upsert_case(
                dataset_id, case.key, case.query, case.type,
                case.constraints, case.golden_data, case.reference_output,
            )
            count += 1

    return {"dataset_id": dataset_id, "cases_count": count, "filter": filter_type}


# ── Dataset Staleness ─────────────────────────────

async def get_staleness_report(dataset_id: int, max_age_days: int = 30) -> dict:
    """Check dataset freshness: which cases have stale or never-validated golden data.

    Args:
        dataset_id: Target dataset.
        max_age_days: Cases validated more than this many days ago are "stale".

    Returns:
        {
            "total_cases": int,
            "validated": int,        # cases with last_validated_at > 0
            "stale": int,            # validated but older than max_age_days
            "never_validated": int,   # last_validated_at == 0
            "fresh": int,            # validated and within max_age_days
            "staleness_pct": float,  # (stale + never_validated) / total
            "cases": [{"key", "query", "last_validated_at", "status", "age_days"}]
        }
    """
    import time
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT key, query, last_validated_at FROM cases WHERE dataset_id = ? ORDER BY last_validated_at ASC",
        (dataset_id,),
    )

    now = time.time()
    threshold = now - (max_age_days * 86400)
    cases = []
    validated = stale = never_validated = fresh = 0

    for r in rows:
        lv = r["last_validated_at"] or 0
        if lv == 0:
            status = "never_validated"
            never_validated += 1
            age_days = None
        elif lv < threshold:
            status = "stale"
            stale += 1
            age_days = round((now - lv) / 86400, 1)
            validated += 1
        else:
            status = "fresh"
            fresh += 1
            age_days = round((now - lv) / 86400, 1)
            validated += 1

        cases.append({
            "key": r["key"],
            "query": r["query"],
            "last_validated_at": lv,
            "status": status,
            "age_days": age_days,
        })

    total = len(rows)
    return {
        "total_cases": total,
        "validated": validated,
        "stale": stale,
        "never_validated": never_validated,
        "fresh": fresh,
        "staleness_pct": round((stale + never_validated) / total, 3) if total else 0,
        "max_age_days": max_age_days,
        "cases": cases,
    }


async def validate_cases(dataset_id: int, case_keys: list[str]) -> int:
    """Mark cases as freshly validated (update last_validated_at to now)."""
    import time
    db = await get_db()
    now = time.time()
    count = 0
    for key in case_keys:
        cursor = await db.execute(
            "UPDATE cases SET last_validated_at = ? WHERE dataset_id = ? AND key = ?",
            (now, dataset_id, key),
        )
        count += cursor.rowcount
    await db.commit()
    return count


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


# ── Transcript Review ───────────────────────────

async def sample_review_queue(
    n: int = 10,
    experiment_id: int | None = None,
    strategy: str = "mixed",
) -> list[dict]:
    """Sample traces for human transcript review.

    Strategies:
        random: pure random sample
        mixed: stratified — 40% failed, 30% borderline (score 40-70), 30% passed
        failures: only failed traces
    """
    db = await get_db()

    base_where = "status IN ('done', 'graded', 'collected') AND review_status = 'pending'"
    params: list = []
    if experiment_id:
        base_where += " AND experiment_id = ?"
        params.append(experiment_id)

    if strategy == "failures":
        sql = f"""SELECT id, case_key, final_score, final_pass, experiment_id, duration_s, case_type
                  FROM traces WHERE {base_where} AND final_pass = 0
                  ORDER BY RANDOM() LIMIT ?"""
        params.append(n)
        rows = await db.execute_fetchall(sql, params)

    elif strategy == "mixed":
        # Stratified: 40% failed, 30% borderline, 30% passed
        n_fail = max(1, int(n * 0.4))
        n_border = max(1, int(n * 0.3))
        n_pass = n - n_fail - n_border

        rows = []
        for condition, limit in [
            ("AND final_pass = 0", n_fail),
            ("AND final_score >= 40 AND final_score <= 70", n_border),
            ("AND final_pass = 1 AND final_score > 70", n_pass),
        ]:
            sql = f"""SELECT id, case_key, final_score, final_pass, experiment_id, duration_s, case_type
                      FROM traces WHERE {base_where} {condition}
                      ORDER BY RANDOM() LIMIT ?"""
            r = await db.execute_fetchall(sql, params + [limit])
            rows.extend(r)

    else:  # random
        sql = f"""SELECT id, case_key, final_score, final_pass, experiment_id, duration_s, case_type
                  FROM traces WHERE {base_where}
                  ORDER BY RANDOM() LIMIT ?"""
        params.append(n)
        rows = await db.execute_fetchall(sql, params)

    return [
        {
            "trace_id": r["id"],
            "case_key": r["case_key"],
            "score": r["final_score"],
            "passed": bool(r["final_pass"]),
            "experiment_id": r["experiment_id"],
            "duration_s": r["duration_s"],
            "case_type": r["case_type"],
        }
        for r in rows
    ]


async def update_review_status(
    trace_id: int, status: str, notes: str = ""
) -> None:
    """Mark a trace as reviewed or flagged."""
    db = await get_db()
    await db.execute(
        "UPDATE traces SET review_status = ?, reviewed_at = ?, review_notes = ? WHERE id = ?",
        (status, time.time(), notes, trace_id),
    )
    await db.commit()


async def get_review_stats() -> dict:
    """Get review coverage statistics."""
    db = await get_db()
    total = await db.execute_fetchone("SELECT COUNT(*) as n FROM traces WHERE status IN ('done', 'graded', 'collected')")
    reviewed = await db.execute_fetchone("SELECT COUNT(*) as n FROM traces WHERE review_status = 'reviewed'")
    flagged = await db.execute_fetchone("SELECT COUNT(*) as n FROM traces WHERE review_status = 'flagged'")
    pending = await db.execute_fetchone("SELECT COUNT(*) as n FROM traces WHERE review_status = 'pending' AND status IN ('done', 'graded', 'collected')")

    t = total["n"] if total else 0
    return {
        "total": t,
        "reviewed": reviewed["n"] if reviewed else 0,
        "flagged": flagged["n"] if flagged else 0,
        "pending": pending["n"] if pending else 0,
        "coverage_pct": round((reviewed["n"] if reviewed else 0) / max(t, 1) * 100, 1),
    }
