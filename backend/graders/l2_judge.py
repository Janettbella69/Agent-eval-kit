"""L2 Agent-as-a-Judge: Claude Agent SDK powered evaluation.

Uses a Claude Agent SDK agent with tools (score_dimension, verify_url)
to holistically evaluate buyer's guides across 5 quality dimensions.

Replaces the previous 5-parallel-API-call approach with a single agent
that can reason across dimensions and verify source URLs.
"""

from graders.types import L2_DIMENSIONS


def _build_full_evidence_summary(l0: dict, l0c: dict, l1: dict) -> str:
    """Build a comprehensive evidence summary from all L0/L1 findings."""
    lines = []

    # Map evidence keys to actual values
    evidence_map = {
        "l0_constraint_score": l0c.get("constraint_score"),
        "l1_entity_count": l1.get("entity_count", {}).get("value"),
        "l1_product_count": l1.get("product_count", {}).get("value"),
        "l1_price_coverage": l1.get("price_coverage", {}).get("value"),
        "l1_has_prices": l1.get("has_prices", {}).get("value"),
        "l1_t1_t2_source_count": l1.get("t1_t2_source_count", {}).get("value"),
        "l1_citation_count": l1.get("citation_count", {}).get("value"),
        "l1_source_domain_count": l1.get("source_domain_count", {}).get("value"),
        "l1_guide_length": l1.get("guide_length", {}).get("value"),
        "l1_has_comparison_table": l1.get("has_comparison_table", {}).get("value"),
        "l1_has_pros_cons": l1.get("has_pros_cons", {}).get("value"),
    }

    # Structure checks
    structure = l0.get("structure", {})
    if structure:
        passing = sum(1 for v in structure.values() if v)
        total = len(structure)
        lines.append(f"Structure checks: {passing}/{total} passed")

    # Constraint checks
    constraint_score = l0c.get("constraint_score")
    if constraint_score is not None:
        lines.append(f"Constraint compliance: {constraint_score:.1%}")

    # All L1 metrics
    for key, val in evidence_map.items():
        if val is not None and not key.startswith("l0_"):
            label = key.replace("l1_", "").replace("_", " ").title()
            lines.append(f"{label}: {val}")

    return "\n".join(lines) if lines else "No automated evidence available."


async def grade_l2(
    result,  # CollectedResult
    case: dict,
    l0: dict,
    l0c: dict,
    l1_breakdown: dict,
) -> dict:
    """Run L2 evaluation using Claude Agent SDK.

    The agent holistically evaluates the guide, optionally verifies URLs,
    and records PASS/FAIL for each of the 5 dimensions via tool calls.

    Returns:
        {"dimensions": {"name": "PASS"|"FAIL"|"UNKNOWN"}, "l2_score": float}
    """
    # Lazy import to avoid circular deps and startup cost
    from agent.eval_agent import run_eval_agent

    evidence_summary = _build_full_evidence_summary(l0, l0c, l1_breakdown)

    return await run_eval_agent(
        query=case["query"],
        guide_text=result.guide_text,
        evidence_summary=evidence_summary,
        products=result.products,
        sources=result.sources,
    )
