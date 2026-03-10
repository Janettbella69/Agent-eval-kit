"""Experiment executor: runs cases, grades results, stores traces."""

import asyncio
import time

from runner.collector import collect_sse, CollectedResult
from graders.l0_structure import grade_structure
from graders.l0_constraints import grade_constraints
from graders.l1_metrics import compute_l1_score
from graders.scoring import compute_final_score
from storage import queries
from runner.progress import get_manager

MAX_AUTO_CLARIFICATIONS = 2


def _pick_clarification_answer(clarification: dict) -> str:
    """Pick a default answer: first option, or generic fallback."""
    options = clarification.get("options", [])
    if options:
        first = options[0]
        return first if isinstance(first, str) else str(first)
    return "give me general recommendations"


async def run_single_case(
    case: dict,
    trial_num: int = 1,
    auto_clarify: bool = True,
) -> dict:
    """Run a single eval case through collect → grade pipeline.

    Args:
        case: {"key", "query", "type", "constraints"}
        trial_num: Trial number (1-indexed).
        auto_clarify: Auto-answer clarification questions.

    Returns:
        Dict with all trace fields ready for DB storage.
    """
    query = case["query"]
    case_type = case.get("type", "clear_en")
    constraints = case.get("constraints", {})
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

    # Grade
    l0 = grade_structure(result, case_type)
    l0c = grade_constraints(result, constraints)
    l1_score, l1_breakdown = compute_l1_score(result, case_type)

    # L2 judge (if enabled — imported lazily to avoid startup cost)
    l2 = None
    try:
        from config import JUDGE_ENABLED
        if JUDGE_ENABLED:
            from graders.l2_judge import grade_l2
            l2 = await grade_l2(result, case, {"structure": l0}, l0c, l1_breakdown)
    except Exception:
        pass

    final_score, is_pass = compute_final_score(l0, l1_score, l2, case_type)

    return {
        "case_key": case["key"],
        "trial_num": trial_num,
        "query": query,
        "case_type": case_type,
        "status": "done",
        "duration_s": result.duration_s,
        "guide_text": result.guide_text,
        "products": result.products,
        "sources": result.sources,
        "events": result.events,
        "hook_metrics": result.hook_metrics,
        "error_events": result.error_events,
        "clarification": result.clarification,
        "l0_scores": {"structure": l0, "constraints": l0c},
        "l1_scores": l1_breakdown,
        "l2_scores": l2,
        "final_score": final_score,
        "final_pass": int(is_pass),
    }


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
    """Run all cases for an experiment with concurrency control.

    Updates DB traces and broadcasts progress via WebSocket.
    """
    _cancel_flags[experiment_id] = False
    manager = get_manager()
    sem = asyncio.Semaphore(concurrency)

    await queries.update_experiment_status(experiment_id, "running")
    manager.broadcast(experiment_id, {"type": "experiment_start", "total": len(cases) * trials})

    async def run_one(case: dict, trial_num: int):
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
                trace_data = await run_single_case(case, trial_num)
        except Exception as e:
            trace_data = {
                "status": "error",
                "error_events": [{"type": "error", "message": str(e)[:500]}],
                "final_score": 0,
                "final_pass": 0,
            }

        await queries.update_trace(trace_id, **trace_data)
        manager.broadcast(experiment_id, {
            "type": "case_done",
            "case_key": case["key"],
            "trial_num": trial_num,
            "trace_id": trace_id,
            "score": trace_data.get("final_score", 0),
            "passed": bool(trace_data.get("final_pass")),
            "duration_s": trace_data.get("duration_s", 0),
        })

    tasks = []
    for case in cases:
        for trial in range(1, trials + 1):
            tasks.append(run_one(case, trial))

    await asyncio.gather(*tasks, return_exceptions=True)

    # Compute and save summary
    summary = await queries.compute_experiment_summary(experiment_id)
    await queries.update_experiment_status(
        experiment_id, "complete",
        summary=summary.model_dump(),
        finished_at=time.time(),
    )
    manager.broadcast(experiment_id, {
        "type": "experiment_done",
        "summary": summary.model_dump(),
    })
    _cancel_flags.pop(experiment_id, None)
