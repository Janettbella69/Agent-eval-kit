"""Full grading pipeline: Gate → Code Graders → LLM Graders → Funnel → Composite.

Two-phase design:
  Phase 1 (collect): Saves raw trace with status="collected"
  Phase 2 (grade): Runs this pipeline, updates trace with scores

This pipeline can be re-run on existing traces (re-grade).
"""

import time

from runner.collector import CollectedResult
from graders.types import GraderResult, GRADER_DEFS, NEGATIVE_TYPES, TRAP_TYPES
from graders.scoring import compute_pass_fail_gate
from graders.composite import compute_composite_score, get_effective_weights
from graders.failure_funnel import detect_failure_stage
from graders.code_graders import (
    grade_rubric_coverage,
    grade_product_matching,
    grade_source_quality,
    grade_output_format,
    grade_constraint_compliance,
    grade_efficiency,
)
from graders.l0_structure import grade_structure
from graders.l0_constraints import grade_constraints
from graders.l1_metrics import compute_l1_score


async def grade_trace(result: CollectedResult, case: dict) -> dict:
    """Run full grading pipeline on a collected result.

    Args:
        result: CollectedResult from SSE collection
        case: {"key", "query", "type", "constraints", "golden_data"}

    Returns dict with all grading details for DB storage.
    """
    t0 = time.time()
    grading_log: list[dict] = []  # Per-step execution log
    case_type = case.get("type", "clear_en")
    constraints = case.get("constraints", {})
    golden_data = case.get("golden_data", {})
    has_golden = bool(golden_data and (golden_data.get("scene_list") or golden_data.get("trap_rubric")))

    # ── Legacy L0/L1/L2 scores (backward compatibility) ──
    l0 = grade_structure(result, case_type)
    l0c = grade_constraints(result, constraints)
    l1_score, l1_breakdown = compute_l1_score(result, case_type)

    # L2 legacy (if enabled)
    l2 = None
    try:
        from config import JUDGE_ENABLED
        if JUDGE_ENABLED:
            from graders.l2_judge import grade_l2 as _grade_l2
            l2 = await _grade_l2(result, case, {"structure": l0}, l0c, l1_breakdown)
    except Exception:
        pass

    # ── Pass/Fail Gate ──
    gate_results, gate_passed = compute_pass_fail_gate(result, case_type)

    # ── Negative cases: special scoring ──
    if case_type in NEGATIVE_TYPES:
        from graders.scoring import compute_final_score
        final, is_pass = compute_final_score(l0, l1_score, l2, case_type)
        return {
            "l0": {"structure": l0, "constraints": l0c},
            "l1": {"score": l1_score, "breakdown": l1_breakdown},
            "l2": l2,
            "final_score": final,
            "final_pass": is_pass,
            "composite_scores": {},
            "failure_funnel": {},
            "error_types": [],
            "grading_duration_s": round(time.time() - t0, 2),
        }

    # ── Code Graders ──
    has_llm = False  # Will be set True if LLM graders run
    try:
        from config import JUDGE_ENABLED
        has_llm = JUDGE_ENABLED
    except Exception:
        pass

    effective_weights = get_effective_weights(case_type, has_golden, has_llm)

    grader_results: list[GraderResult] = []

    def _run_code_grader(name: str, fn, *args):
        """Run a code grader and log its execution."""
        gt = time.time()
        try:
            r = fn(*args)
            r.weight = effective_weights[name]
            grader_results.append(r)
            grading_log.append({
                "step": name, "category": "code", "score": r.score,
                "weight": r.weight, "duration_s": round(time.time() - gt, 3),
                "error_types": r.error_types, "status": "ok",
            })
        except Exception as e:
            grading_log.append({
                "step": name, "category": "code", "score": None,
                "duration_s": round(time.time() - gt, 3),
                "status": "error", "error": str(e)[:200],
            })

    if effective_weights.get("rubric_coverage", 0) > 0:
        _run_code_grader("rubric_coverage", grade_rubric_coverage, result, golden_data)
    if effective_weights.get("product_matching", 0) > 0:
        _run_code_grader("product_matching", grade_product_matching, result, golden_data)
    if effective_weights.get("source_quality", 0) > 0:
        _run_code_grader("source_quality", grade_source_quality, result, golden_data)
    if effective_weights.get("output_format", 0) > 0:
        _run_code_grader("output_format", grade_output_format, result)
    if effective_weights.get("constraint_compliance", 0) > 0:
        _run_code_grader("constraint_compliance", grade_constraint_compliance, result, constraints)
    if effective_weights.get("efficiency", 0) > 0:
        _run_code_grader("efficiency", grade_efficiency, result)

    # ── LLM Graders (graceful degradation) ──
    if has_llm:
        try:
            from graders.llm_graders import (
                grade_rubric_compliance,
                grade_trap_detection,
                grade_actionability,
            )

            async def _run_llm_grader_logged(name: str, fn, *args):
                gt = time.time()
                try:
                    r = await fn(*args)
                    r.weight = effective_weights[name]
                    grader_results.append(r)
                    log_entry = {
                        "step": name, "category": "llm", "score": r.score,
                        "weight": r.weight, "duration_s": round(time.time() - gt, 3),
                        "error_types": r.error_types, "status": "ok",
                    }
                    if r.details.get("revision_count", 1) > 1:
                        log_entry["revisions"] = r.details.get("revision_count", 1)
                    if r.details.get("reasoning"):
                        log_entry["reasoning_preview"] = str(r.details["reasoning"])[:300]
                    grading_log.append(log_entry)
                except Exception as e:
                    grading_log.append({
                        "step": name, "category": "llm", "score": None,
                        "duration_s": round(time.time() - gt, 3),
                        "status": "error", "error": str(e)[:200],
                    })

            if effective_weights.get("rubric_compliance", 0) > 0:
                await _run_llm_grader_logged("rubric_compliance", grade_rubric_compliance, result, golden_data)

            if effective_weights.get("trap_detection", 0) > 0 and case_type in TRAP_TYPES:
                await _run_llm_grader_logged("trap_detection", grade_trap_detection, result, golden_data)

            if effective_weights.get("actionability", 0) > 0:
                await _run_llm_grader_logged("actionability", grade_actionability, result)
        except Exception:
            # LLM graders failed — graceful degradation
            pass

    # ── Composite Score ──
    composite_score, is_pass = compute_composite_score(grader_results, case_type)

    # Override: gate failure forces fail
    if not gate_passed:
        is_pass = False

    grading_log.append({
        "step": "gate", "category": "system",
        "passed": gate_passed, "results": gate_results,
    })
    grading_log.append({
        "step": "composite", "category": "system",
        "score": composite_score, "is_pass": is_pass,
        "n_graders": len(grader_results),
    })

    # ── Failure Funnel ──
    grader_score_map = {g.name: g.score for g in grader_results}
    funnel = detect_failure_stage(result, golden_data, grader_score_map)

    # ── Aggregate error types ──
    all_error_types = []
    for g in grader_results:
        all_error_types.extend(g.error_types)

    # ── Build composite_scores dict ──
    composite_dict = {}
    for g in grader_results:
        composite_dict[g.name] = {
            "score": g.score,
            "weight": g.weight,
            "category": g.category,
            "details": g.details,
            "error_types": g.error_types,
        }

    # ── Also compute legacy final_score for backward compatibility ──
    # Use composite score as the new final_score
    final_score = composite_score

    total_duration = round(time.time() - t0, 2)
    grading_log.append({
        "step": "total", "category": "system",
        "duration_s": total_duration,
    })

    return {
        "l0": {"structure": l0, "constraints": l0c},
        "l1": {"score": l1_score, "breakdown": l1_breakdown},
        "l2": l2,
        "final_score": final_score,
        "final_pass": is_pass,
        "composite_scores": composite_dict,
        "failure_funnel": {
            "stage": funnel.stage,
            "reason": funnel.reason,
            "stages": funnel.stages,
        },
        "error_types": all_error_types,
        "grading_duration_s": total_duration,
        "grading_log": grading_log,
        "gate": {"results": gate_results, "passed": gate_passed},
    }
