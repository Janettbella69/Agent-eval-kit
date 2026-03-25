"""Grader type definitions for the eval platform.

All graders produce GraderResult with a 0-100 score, weight, and error classification.
"""

from dataclasses import dataclass, field


@dataclass
class GraderResult:
    """Output of a single grader."""
    name: str           # grader name (e.g., "rubric_coverage")
    score: float        # 0-100
    weight: float       # weight in composite score
    category: str       # "code" | "llm"
    details: dict = field(default_factory=dict)    # grader-specific details
    error_types: list[str] = field(default_factory=list)  # e.g. ["missing_product:Sony Alpha 6700"]


@dataclass
class FunnelResult:
    """Failure Funnel output — identifies the first failing stage."""
    stage: str | None = None    # first failing stage, None if all passed
    reason: str = ""
    stages: dict[str, str] = field(default_factory=dict)  # {stage: "pass"|"fail"}


# ── Grader Definitions ───────────────────────────

@dataclass
class GraderDef:
    """Definition of a grader with its weight and type."""
    name: str
    weight: float
    category: str       # "code" | "llm"
    requires_golden: bool = False  # requires golden_data to run


# Standard grader weights (normal cases)
# Weights sum to 1.0; composite.py normalizes if some graders are skipped.
#
# Design principles (Anthropic eval blog + Coze Loop Re-Act Agent eval, 2026-03-25):
# 1. Three evaluator types: Code (deterministic), LLM (semantic), Agent (tools+LLM)
# 2. Anthropic: Graders evaluate BOTH trajectory AND outcome → scores
# 3. Coze Loop: 任务完成度 + 工具选择正确性 + 工具参数正确性 + 轨迹质量
# 4. Trajectory graders assess decision quality (not penalize non-standard paths)
# 5. Tracked metrics (efficiency) record but don't score
GRADER_DEFS = [
    # ── Outcome Code Graders (38%) — "What did the agent produce?" ──
    GraderDef("product_matching",      0.10, "code", requires_golden=True),  # found the right products?
    GraderDef("source_authority",      0.08, "code"),   # sources authoritative (T1-T6)?
    GraderDef("retrieval_quality",     0.07, "code"),   # search coverage + source diversity
    GraderDef("output_format",         0.07, "code"),   # structure: table, citations, pros/cons
    GraderDef("rubric_coverage",       0.05, "code", requires_golden=True),  # keyword coverage (weak for CJK)
    GraderDef("state_check",           0.00, "code"),   # disabled: duplicates gate checks
    # ── Trajectory Code Graders (10%) — "Were the agent's decisions good?" ──
    GraderDef("tool_calls",            0.05, "code"),   # Tool selection quality (right tools for the job?)
    GraderDef("transcript",            0.04, "code"),   # Trajectory quality (efficient path? no loops?)
    GraderDef("search_quality",        0.05, "code"),   # Search query quality (specific? diverse? expert sources?)
    # ── Tracked Metrics (weight=0) — recorded but not scored ──
    GraderDef("efficiency",            0.00, "code"),   # tracked: products per search (noisy metric)
    # ── LLM Semantic Judges (48%) — Binary PASS/FAIL ──
    GraderDef("rubric_compliance",     0.20, "llm",  requires_golden=True),  # Coverage: rubric requirements met?
    GraderDef("groundedness",          0.20, "llm"),   # Groundedness: claims supported by sources?
    GraderDef("actionability",         0.08, "llm"),   # can user make purchase decision?
    GraderDef("trap_detection",        0.06, "llm",  requires_golden=True),  # risk/trap identified?
]

# Trap case weight overrides
TRAP_WEIGHT_OVERRIDES = {
    "trap_detection":        0.35,
    "groundedness":          0.15,
    "product_matching":      0.05,
    "rubric_coverage":       0.00,
    "rubric_compliance":     0.00,
    "source_authority":      0.10,
    "output_format":         0.05,
    "actionability":         0.10,
    "efficiency":            0.03,
    "tool_calls":            0.05,
    "transcript":            0.05,
    "state_check":           0.00,  # disabled
    "retrieval_quality":     0.00,
}

# Failure funnel stages (in order)
FUNNEL_STAGES = ["understand", "search", "extract", "match_rubric", "generate"]

# Pass/fail gate checks for positive cases
GATE_CHECKS_POSITIVE = {
    "has_guide":    lambda r: len(r.guide_text) > 500,
    "has_products": lambda r: len(r.products) >= 1,
    "has_sources":  lambda r: len(r.sources) >= 1,
    "no_error":     lambda r: len(r.error_events) == 0,
}

# Pass/fail gate checks for trap/negative cases
GATE_CHECKS_TRAP = {
    "kept_brief":    lambda r: len(r.guide_text) < 5000,
    "few_searches":  lambda r: r.hook_metrics.get("search_count", 0) <= 6,
    "no_error":      lambda r: len(r.error_events) == 0,
}

NEGATIVE_TYPES = {"negative"}
TRAP_TYPES = {"trap"}


# ── Legacy L2 Dimensions (backward compat for l2_judge.py + eval_agent.py) ──

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
        evidence_keys=[],
    ),
]
