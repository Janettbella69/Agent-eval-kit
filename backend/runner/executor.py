"""Experiment executor: two-phase collect → grade pipeline with circuit breaker.

Phase 1 (Collect): Run cases through product backend, save raw traces
Phase 2 (Grade): Run grading pipeline on collected traces, save scores
Phase 3 (Aggregate): Compute experiment summary with pass@k metrics
"""

import asyncio
import time

from runner.collector import collect_sse, CollectedResult
from graders.pipeline import grade_trace as grade_trace_pipeline
from storage import queries
from runner.progress import get_manager

MAX_AUTO_CLARIFICATIONS = 2
CIRCUIT_BREAKER_THRESHOLD = 3  # consecutive errors → auto-pause


def _pick_clarification_answer(clarification: dict) -> str:
    """Pick a default answer: first option, or generic fallback."""
    options = clarification.get("options", [])
    if options:
        first = options[0]
        return first if isinstance(first, str) else str(first)
    return "give me general recommendations"


async def collect_single_case(
    case: dict,
    trial_num: int = 1,
    auto_clarify: bool = True,
) -> CollectedResult:
    """Collect SSE events for a single case (Phase 1 only — no grading).

    Args:
        case: {"key", "query", "type", "constraints", "golden_data"}
        trial_num: Trial number (1-indexed).
        auto_clarify: Auto-answer clarification questions.

    Returns:
        CollectedResult with raw SSE data.
    """
    query = case["query"]
    history: list[dict] = []

    result: CollectedResult | None = None
    clarification_count = 0

    while True:
        result = await collect_sse(query, history)

        # Auto-answer clarifications
        if result.clarification and auto_clarify and clarification_count < MAX_AUTO_CLARIFICATIONS:
            clarification_count += 1
            answer = _pick_clarification_answer(result.clarification)
            history.append({"role": "assistant", "content": f"[clarification] {result.clarification.get('question', '')}"})
            history.append({"role": "user", "content": answer})
            continue

        break

    return result


def _result_to_trace_data(result: CollectedResult, case: dict, trial_num: int) -> dict:
    """Convert CollectedResult to trace data dict for DB storage."""
    return {
        "case_key": case["key"],
        "trial_num": trial_num,
        "query": case["query"],
        "case_type": case.get("type", "clear_en"),
        "status": "collected",
        "duration_s": result.duration_s,
        "guide_text": result.guide_text,
        "products": result.products,
        "sources": result.sources,
        "events": result.events,
        "hook_metrics": result.hook_metrics,
        "error_events": result.error_events,
        "clarification": result.clarification,
    }


async def _grade_single_trace(trace: queries.Trace, case: dict) -> dict:
    """Run grading pipeline on a collected trace.

    Reconstructs a CollectedResult from trace data and runs the full pipeline.
    """
    result = CollectedResult(
        guide_text=trace.guide_text,
        products=trace.products,
        sources=trace.sources,
        events=trace.events,
        hook_metrics=trace.hook_metrics,
        error_events=trace.error_events,
        clarification=trace.clarification,
        duration_s=trace.duration_s,
    )

    grades = await grade_trace_pipeline(result, case)
    return grades


# In-flight experiment cancellation tokens
_cancel_flags: dict[int, bool] = {}


def request_stop(experiment_id: int):
    _cancel_flags[experiment_id] = True


async def run_experiment(
    experiment_id: int,
    cases: list[dict],
    concurrency: int = 1,
    trials: int = 1,
):
    """Run all cases for an experiment: Phase 1 (collect) → Phase 2 (grade) → Phase 3 (aggregate).

    Updates DB traces and broadcasts progress via WebSocket.
    """
    _cancel_flags[experiment_id] = False
    manager = get_manager()
    sem = asyncio.Semaphore(concurrency)

    await queries.update_experiment_status(experiment_id, "running")
    total = len(cases) * trials
    manager.broadcast(experiment_id, {"type": "experiment_start", "total": total})

    # ── Phase 1: Collect ──
    collected_trace_ids: list[int] = []
    consecutive_errors = 0
    case_map: dict[str, dict] = {c["key"]: c for c in cases}

    async def collect_one(case: dict, trial_num: int):
        nonlocal consecutive_errors

        if _cancel_flags.get(experiment_id):
            return

        trace_id = await queries.create_trace(
            experiment_id, case["key"], trial_num, case["query"], case.get("type", "clear_en"),
        )
        manager.broadcast(experiment_id, {
            "type": "case_start",
            "case_key": case["key"],
            "trial_num": trial_num,
            "trace_id": trace_id,
        })

        try:
            async with sem:
                result = await collect_single_case(case, trial_num)

            trace_data = _result_to_trace_data(result, case, trial_num)
            await queries.update_trace(trace_id, **trace_data)
            collected_trace_ids.append(trace_id)
            consecutive_errors = 0  # Reset on success

            manager.broadcast(experiment_id, {
                "type": "case_collected",
                "case_key": case["key"],
                "trial_num": trial_num,
                "trace_id": trace_id,
                "duration_s": result.duration_s,
            })

        except Exception as e:
            await queries.update_trace(trace_id, **{
                "status": "error",
                "error_events": [{"type": "error", "message": str(e)[:500]}],
                "final_score": 0,
                "final_pass": 0,
            })
            consecutive_errors += 1

            manager.broadcast(experiment_id, {
                "type": "case_error",
                "case_key": case["key"],
                "trial_num": trial_num,
                "trace_id": trace_id,
                "error": str(e)[:200],
            })

            # Circuit breaker
            if consecutive_errors >= CIRCUIT_BREAKER_THRESHOLD:
                reason = f"Circuit breaker: {consecutive_errors} consecutive errors"
                await queries.update_experiment_status(experiment_id, "paused")
                manager.broadcast(experiment_id, {
                    "type": "circuit_break",
                    "reason": reason,
                    "consecutive_errors": consecutive_errors,
                })
                _cancel_flags[experiment_id] = True

    collect_tasks = []
    for case in cases:
        for trial in range(1, trials + 1):
            collect_tasks.append(collect_one(case, trial))

    await asyncio.gather(*collect_tasks, return_exceptions=True)

    # Check if circuit breaker was triggered
    if _cancel_flags.get(experiment_id):
        # Still grade whatever was collected
        pass

    # ── Phase 2: Grade ──
    if collected_trace_ids:
        manager.broadcast(experiment_id, {
            "type": "grading_start",
            "total": len(collected_trace_ids),
        })

        for trace_id in collected_trace_ids:
            trace = await queries.get_trace(trace_id)
            if not trace or trace.status == "error":
                continue

            case = case_map.get(trace.case_key, {"key": trace.case_key, "query": trace.query,
                                                  "type": trace.case_type, "constraints": {}, "golden_data": {}})

            try:
                grades = await _grade_single_trace(trace, case)
                await queries.update_trace(trace_id, **{
                    "status": "done",
                    "l0_scores": grades.get("l0", {}),
                    "l1_scores": grades.get("l1", {}).get("breakdown", {}),
                    "l2_scores": grades.get("l2"),
                    "final_score": grades.get("final_score", 0),
                    "final_pass": int(grades.get("final_pass", False)),
                    "composite_scores": grades.get("composite_scores", {}),
                    "failure_funnel": grades.get("failure_funnel", {}),
                    "error_types": grades.get("error_types", []),
                    "grading_duration_s": grades.get("grading_duration_s", 0),
                    "grading_log": grades.get("grading_log", []),
                })

                manager.broadcast(experiment_id, {
                    "type": "case_graded",
                    "case_key": trace.case_key,
                    "trial_num": trace.trial_num,
                    "trace_id": trace_id,
                    "score": grades.get("final_score", 0),
                    "passed": bool(grades.get("final_pass")),
                })
            except Exception:
                # Grading error — mark trace with what we have
                await queries.update_trace(trace_id, status="done", final_score=0, final_pass=0)

    # ── Phase 3: Aggregate ──
    summary = await queries.compute_experiment_summary(experiment_id)

    status = "complete"
    if _cancel_flags.get(experiment_id) and consecutive_errors >= CIRCUIT_BREAKER_THRESHOLD:
        status = "paused"

    await queries.update_experiment_status(
        experiment_id, status,
        summary=summary.model_dump(),
        finished_at=time.time(),
    )
    manager.broadcast(experiment_id, {
        "type": "experiment_done",
        "summary": summary.model_dump(),
    })
    _cancel_flags.pop(experiment_id, None)


async def regrade_experiment(experiment_id: int) -> int:
    """Re-grade all collected/graded traces in an experiment.

    Returns the number of traces re-graded.
    """
    experiment = await queries.get_experiment(experiment_id)
    if not experiment:
        return 0

    # Get all cases for golden_data
    all_cases = await queries.get_cases(experiment.dataset_id)
    case_map = {c.key: {"key": c.key, "query": c.query, "type": c.type,
                        "constraints": c.constraints, "golden_data": c.golden_data}
                for c in all_cases}

    traces = await queries.get_collected_traces(experiment_id)
    count = 0

    for trace in traces:
        case = case_map.get(trace.case_key, {"key": trace.case_key, "query": trace.query,
                                              "type": trace.case_type, "constraints": {}, "golden_data": {}})
        try:
            grades = await _grade_single_trace(trace, case)
            await queries.update_trace(trace.id, **{
                "status": "done",
                "l0_scores": grades.get("l0", {}),
                "l1_scores": grades.get("l1", {}).get("breakdown", {}),
                "l2_scores": grades.get("l2"),
                "final_score": grades.get("final_score", 0),
                "final_pass": int(grades.get("final_pass", False)),
                "composite_scores": grades.get("composite_scores", {}),
                "failure_funnel": grades.get("failure_funnel", {}),
                "error_types": grades.get("error_types", []),
                "grading_duration_s": grades.get("grading_duration_s", 0),
                "grading_log": grades.get("grading_log", []),
            })
            count += 1
        except Exception:
            continue

    # Recompute summary
    summary = await queries.compute_experiment_summary(experiment_id)
    await queries.update_experiment_status(
        experiment_id, "complete",
        summary=summary.model_dump(),
        finished_at=time.time(),
    )

    return count
