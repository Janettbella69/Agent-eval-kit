"""Failure Funnel — identifies the first failing stage in the agent pipeline.

Stages (in order):
  understand → search → extract → match_rubric → generate

The first failing stage = root cause of overall failure.

IMPORTANT: All stage checks use DETERMINISTIC signals (event counts, text length,
product/source counts) — never LLM grader scores, which may be unavailable.
"""

from graders.types import FunnelResult, FUNNEL_STAGES
from runner.collector import CollectedResult


def detect_failure_stage(
    result: CollectedResult,
    golden_data: dict,
    grader_scores: dict[str, float],
) -> FunnelResult:
    """Detect the first failing stage in the agent pipeline.

    Args:
        result: The collected SSE result
        golden_data: Golden data for the case (may be empty)
        grader_scores: {grader_name: score 0-100} from code/llm graders

    Returns:
        FunnelResult with stage, reason, and per-stage pass/fail
    """
    stages: dict[str, str] = {}
    first_fail: str | None = None
    reason = ""

    search_count = result.hook_metrics.get("search_count", 0)
    has_products = len(result.products) > 0
    has_sources = len(result.sources) > 0
    guide_len = len(result.guide_text)

    # 1. understand: Did the agent understand the query?
    # Use deterministic signals only — no LLM grader dependency
    if search_count == 0 and guide_len < 100:
        stages["understand"] = "fail"
        if not first_fail:
            first_fail = "understand"
            reason = "No searches performed and no guide generated"
    elif search_count > 0 and not has_products and not has_sources and guide_len < 200:
        stages["understand"] = "fail"
        if not first_fail:
            first_fail = "understand"
            reason = f"{search_count} searches but no products, no sources, minimal guide"
    else:
        stages["understand"] = "pass"

    # 2. search: Did searches find useful content?
    if search_count > 0 and not has_products and not has_sources:
        stages["search"] = "fail"
        if not first_fail:
            first_fail = "search"
            reason = f"Performed {search_count} searches but found 0 products and 0 sources"
    else:
        stages["search"] = "pass"

    # 3. extract: Did extraction yield structured data?
    if has_sources and not has_products and guide_len > 500:
        stages["extract"] = "fail"
        if not first_fail:
            first_fail = "extract"
            reason = "Has sources but failed to extract any product data"
    else:
        stages["extract"] = "pass"

    # 4. match_rubric: Do products match golden expectations?
    # Use code grader score (deterministic, always available if golden_data exists)
    product_matching = grader_scores.get("product_matching", None)
    if product_matching is not None and product_matching < 30 and golden_data.get("product_list"):
        stages["match_rubric"] = "fail"
        if not first_fail:
            first_fail = "match_rubric"
            reason = f"Product matching score {product_matching:.0f} — golden products missed"
    else:
        stages["match_rubric"] = "pass"

    # 5. generate: Was the output well-formed?
    # Use deterministic checks: guide length + presence of key markers
    if has_products and guide_len < 500:
        stages["generate"] = "fail"
        if not first_fail:
            first_fail = "generate"
            reason = f"Guide too short ({guide_len} chars) despite having products"
    elif has_products and has_sources and guide_len < 1000:
        # Has data but guide is suspiciously short
        stages["generate"] = "fail"
        if not first_fail:
            first_fail = "generate"
            reason = f"Guide only {guide_len} chars with {len(result.products)} products and {len(result.sources)} sources"
    else:
        stages["generate"] = "pass"

    return FunnelResult(stage=first_fail, reason=reason, stages=stages)
