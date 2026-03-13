"""Score computation: Pass/Fail gate + composite scoring.

Two-layer scoring:
  Layer 1: Pass/Fail Gate (deterministic, binary)
  Layer 2: Composite Score (weighted 0-100)
"""

from runner.collector import CollectedResult
from graders.types import (
    GATE_CHECKS_POSITIVE, GATE_CHECKS_TRAP,
    NEGATIVE_TYPES, TRAP_TYPES,
)
from config import PASS_THRESHOLD


def compute_pass_fail_gate(
    result: CollectedResult,
    case_type: str,
) -> tuple[dict[str, bool], bool]:
    """Run pass/fail gate checks.

    Returns (gate_results: {check_name: bool}, all_passed: bool).
    """
    if case_type in NEGATIVE_TYPES or case_type in TRAP_TYPES:
        checks = GATE_CHECKS_TRAP
    else:
        checks = GATE_CHECKS_POSITIVE

    gate_results = {}
    for name, check_fn in checks.items():
        try:
            gate_results[name] = check_fn(result)
        except Exception:
            gate_results[name] = False

    all_passed = all(gate_results.values())
    return gate_results, all_passed


def compute_final_score(
    l0: dict[str, bool],
    l1_score: int,
    l2: dict | None,
    case_type: str,
) -> tuple[float, bool]:
    """Legacy score computation combining L0, L1, and L2 grades.

    Kept for backward compatibility with existing traces.
    New traces use composite scoring via pipeline.py.

    Weights:
        L2 available:   L0(10%) + L1(40%) + L2(50%)
        L2 unavailable: L0(15%) + L1(85%)

    Returns (score 0-100, is_pass).
    """
    # L0 score: fraction of passing checks × 100
    l0_checks = list(l0.values())
    l0_score = (sum(l0_checks) / len(l0_checks) * 100) if l0_checks else 100

    if l2 is not None and l2.get("l2_score") is not None:
        l2_score = l2["l2_score"]
        final = l0_score * 0.10 + l1_score * 0.40 + l2_score * 0.50
    else:
        final = l0_score * 0.15 + l1_score * 0.85

    final = round(final, 1)
    return final, final >= PASS_THRESHOLD
