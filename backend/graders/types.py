"""Grader type definitions — standalone, no product backend imports."""

from dataclasses import dataclass, field


@dataclass
class L2Dimension:
    name: str
    criteria: str
    evidence_keys: list[str] = field(default_factory=list)


L2_DIMENSIONS = [
    L2Dimension(
        name="relevance",
        criteria="Does the guide directly address the user's query? Are recommended products appropriate for the stated needs, budget, and use case?",
        evidence_keys=["l0_constraint_score", "l1_entity_count", "l1_product_count"],
    ),
    L2Dimension(
        name="actionability",
        criteria="Can the user make a purchase decision from this guide? Are prices current, purchase links provided, and clear recommendations given?",
        evidence_keys=["l1_price_coverage", "l1_has_prices", "l1_product_count"],
    ),
    L2Dimension(
        name="evidence_quality",
        criteria="Are claims backed by credible sources? Are expert reviews and measurements cited rather than just marketing copy?",
        evidence_keys=["l1_t1_t2_source_count", "l1_citation_count", "l1_source_domain_count"],
    ),
    L2Dimension(
        name="completeness",
        criteria="Does the guide cover the topic thoroughly? Comparison table, pros/cons, alternatives, and edge cases addressed?",
        evidence_keys=["l1_guide_length", "l1_has_comparison_table", "l1_has_pros_cons"],
    ),
    L2Dimension(
        name="objectivity",
        criteria="Is the guide balanced and fair? Does it acknowledge trade-offs, mention drawbacks, and avoid promotional language?",
        evidence_keys=[],  # No L0/L1 proxy — requires LLM judgment
    ),
]
