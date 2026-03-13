"""Composite score engine — weighted aggregation with graceful degradation.

Handles:
- Normal cases: all 9 graders at standard weights
- Trap cases: weight overrides (trap_detection boosted)
- Missing golden_data: skip graders requiring golden data, scale up remaining
- Skipped LLM graders: scale up code grader weights proportionally
"""

from graders.types import GraderResult, GraderDef, GRADER_DEFS, TRAP_WEIGHT_OVERRIDES, TRAP_TYPES
from config import PASS_THRESHOLD


def compute_composite_score(
    grader_results: list[GraderResult],
    case_type: str,
) -> tuple[float, bool]:
    """Compute weighted composite score from grader results.

    Returns (score 0-100, is_pass).
    """
    if not grader_results:
        return 0, False

    # Filter out graders with weight=0 (skipped)
    active = [g for g in grader_results if g.weight > 0]
    if not active:
        return 0, False

    # Recompute weights based on what's actually available
    total_weight = sum(g.weight for g in active)
    if total_weight <= 0:
        return 0, False

    # Scale weights to sum to 1.0
    weighted_sum = sum(g.score * (g.weight / total_weight) for g in active)
    final = round(weighted_sum, 1)
    return final, final >= PASS_THRESHOLD


def get_effective_weights(
    case_type: str,
    has_golden_data: bool,
    has_llm_graders: bool,
) -> dict[str, float]:
    """Get effective weights for each grader given the case context.

    Handles weight overrides for trap cases and graceful degradation
    when golden_data or LLM graders are unavailable.
    """
    weights: dict[str, float] = {}

    for gdef in GRADER_DEFS:
        if case_type in TRAP_TYPES:
            weight = TRAP_WEIGHT_OVERRIDES.get(gdef.name, gdef.weight)
        else:
            weight = gdef.weight

        # Skip graders that require golden data when it's not available
        if gdef.requires_golden and not has_golden_data:
            weight = 0

        # Skip LLM graders when not available
        if gdef.category == "llm" and not has_llm_graders:
            weight = 0

        weights[gdef.name] = weight

    return weights
