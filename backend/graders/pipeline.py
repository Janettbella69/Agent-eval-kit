"""Full grading pipeline: L0 → L1 → L2 with fail-open design."""

from runner.collector import CollectedResult
from graders.l0_structure import grade_structure
from graders.l0_constraints import grade_constraints
from graders.l1_metrics import compute_l1_score
from graders.l2_judge import grade_l2 as _grade_l2
from graders.scoring import compute_final_score


async def grade_trace(result: CollectedResult, case: dict) -> dict:
    """Run full grading pipeline on a collected result.

    Returns dict with all grading details.
    """
    case_type = case.get("type", "clear_en")
    constraints = case.get("constraints", {})

    l0 = grade_structure(result, case_type)
    l0c = grade_constraints(result, constraints)
    l1_score, l1_breakdown = compute_l1_score(result, case_type)

    # L2 receives L0/L1 as evidence (Agent-as-a-Judge pattern)
    l2 = None
    try:
        from config import JUDGE_ENABLED
        if JUDGE_ENABLED:
            l2 = await _grade_l2(result, case, {"structure": l0}, l0c, l1_breakdown)
    except Exception:
        pass

    final, is_pass = compute_final_score(l0, l1_score, l2, case_type)

    return {
        "l0": {"structure": l0, "constraints": l0c},
        "l1": {"score": l1_score, "breakdown": l1_breakdown},
        "l2": l2,
        "final_score": final,
        "final_pass": is_pass,
    }
