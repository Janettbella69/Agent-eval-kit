"""L0 structure grader: binary pass/fail checks on result shape."""

from runner.collector import CollectedResult

NEGATIVE_TYPES = {"negative"}


def grade_structure(result: CollectedResult, case_type: str) -> dict[str, bool]:
    """Check structural requirements based on case type.

    Positive cases: must have guide, products, sources, no errors.
    Negative cases: should be brief with few searches.
    """
    if case_type in NEGATIVE_TYPES:
        return {
            "kept_brief": len(result.guide_text) < 2000,
            "few_searches": result.hook_metrics.get("search_count", 0) <= 3,
            "no_error": len(result.error_events) == 0,
        }

    return {
        "has_guide": len(result.guide_text) > 500,
        "has_products": len(result.products) >= 1,
        "has_sources": len(result.sources) >= 1,
        "no_error": len(result.error_events) == 0,
    }
