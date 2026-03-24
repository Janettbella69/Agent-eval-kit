"""Structured error taxonomy for shopping research agent evaluation.

Based on Hamel Husain's error-analysis skill:
  "Do NOT start with a pre-defined failure list. Let categories emerge."

However, after running 100+ traces through our eval system, these categories
have emerged from actual observation. They should be validated and refined
as more traces are reviewed.

Each category:
- Is distinct (a failure belongs to exactly one category)
- Is actionable (points toward a specific fix)
- Has a clear definition for consistent annotation

Taxonomy is organized into ROOT CAUSE categories (where the pipeline broke),
not symptoms. E.g., "stale_price" is the root cause; "wrong price in guide"
is a symptom.
"""

from dataclasses import dataclass, field


@dataclass
class ErrorCategory:
    """A structured error category in the taxonomy."""
    code: str              # Machine-readable code (e.g., "retrieval.stale_data")
    name: str              # Human-readable name
    description: str       # 1-sentence definition for annotators
    stage: str             # Pipeline stage: retrieval | extraction | generation | format
    severity: str          # critical | major | minor
    fix_hint: str          # What to fix (for developers)
    examples: list[str] = field(default_factory=list)  # Example manifestations


# ── The Taxonomy ──────────────────────────────────

TAXONOMY: list[ErrorCategory] = [
    # ── Retrieval failures (agent didn't search well) ──
    ErrorCategory(
        code="retrieval.insufficient_search",
        name="Insufficient Research",
        description="Agent performed too few or too narrow searches to cover the query's requirements.",
        stage="retrieval",
        severity="major",
        fix_hint="Improve search strategy in prompt — require minimum search diversity",
        examples=[
            "Query asks for 'laptop for video editing and gaming' but agent only searched for gaming laptops",
            "Only 2 searches performed for a complex multi-criteria query",
        ],
    ),
    ErrorCategory(
        code="retrieval.wrong_category",
        name="Wrong Product Category",
        description="Agent searched for or recommended products in the wrong category entirely.",
        stage="retrieval",
        severity="critical",
        fix_hint="Improve query understanding — add category validation step",
        examples=[
            "Query: 'best wireless mouse for FPS gaming' → agent searched for keyboards",
            "Query: 'noise-cancelling headphones' → recommended open-back headphones",
        ],
    ),
    ErrorCategory(
        code="retrieval.search_loop",
        name="Search Loop",
        description="Agent repeated similar searches without finding new information (3+ consecutive stale searches).",
        stage="retrieval",
        severity="minor",
        fix_hint="Hook already detects this — check if adaptive guidance is working",
        examples=[
            "Searched 'best wireless earbuds' 4 times with minor variations",
            "Kept retrying a blocked URL instead of trying alternatives",
        ],
    ),
    ErrorCategory(
        code="retrieval.missed_expert_source",
        name="Missed Expert Source",
        description="Agent failed to consult the obvious expert source for this product category (e.g., RTINGS for headphones).",
        stage="retrieval",
        severity="major",
        fix_hint="Source reference table in prompt may need updating for this category",
        examples=[
            "Headphone review without RTINGS or SoundGuys",
            "Laptop comparison without Notebookcheck or LaptopMag",
        ],
    ),

    # ── Extraction failures (data pulled from pages was wrong) ──
    ErrorCategory(
        code="extraction.stale_price",
        name="Stale/Wrong Price",
        description="Price shown in guide doesn't match current market price (>15% deviation or discontinued price).",
        stage="extraction",
        severity="critical",
        fix_hint="Add price freshness verification — cross-reference multiple sources",
        examples=[
            "Guide says '$299' but product is now $349 (price increase)",
            "Shows sale price that expired weeks ago",
        ],
    ),
    ErrorCategory(
        code="extraction.discontinued_product",
        name="Discontinued Product",
        description="Recommended product is discontinued, recalled, or no longer available for purchase.",
        stage="extraction",
        severity="critical",
        fix_hint="Add availability checks — verify purchase URLs resolve",
        examples=[
            "Recommends a phone model that was replaced by successor 6 months ago",
            "Product page returns 404 or 'no longer available'",
        ],
    ),
    ErrorCategory(
        code="extraction.wrong_spec",
        name="Incorrect Specification",
        description="A specific technical spec (battery life, weight, resolution, etc.) is wrong in the guide.",
        stage="extraction",
        severity="major",
        fix_hint="Groundedness grader should catch this — check if it's being verified",
        examples=[
            "Says '40-hour battery life' when actual spec is 30 hours",
            "Lists wrong display resolution (1080p instead of actual 4K)",
        ],
    ),
    ErrorCategory(
        code="extraction.phantom_citation",
        name="Phantom Citation",
        description="Guide cites a source that doesn't actually support the claim, or the source URL is fabricated.",
        stage="extraction",
        severity="major",
        fix_hint="Groundedness grader URL verification — check verify_url results",
        examples=[
            "[[RTINGS]](url) cited for battery life claim, but RTINGS page is about a different product",
            "Source URL returns 404 or points to unrelated content",
        ],
    ),

    # ── Generation failures (synthesis/output problems) ──
    ErrorCategory(
        code="generation.hallucinated_feature",
        name="Hallucinated Feature",
        description="Guide mentions a product feature that doesn't exist (not a wrong spec, but entirely made up).",
        stage="generation",
        severity="critical",
        fix_hint="Strengthen groundedness grader — add 'feature existence' checks",
        examples=[
            "Claims headphones have 'spatial audio with head tracking' when they don't",
            "Invents a 'ProMotion display' for a non-Apple product",
        ],
    ),
    ErrorCategory(
        code="generation.missing_tradeoff",
        name="Missing Trade-off",
        description="Guide recommends a product without mentioning a significant known drawback.",
        stage="generation",
        severity="major",
        fix_hint="Prompt should require mentioning top 1-2 drawbacks per product",
        examples=[
            "Recommends a great-sounding headphone without mentioning poor noise cancellation",
            "Top-pick laptop without mentioning short battery life",
        ],
    ),
    ErrorCategory(
        code="generation.promotional_tone",
        name="Promotional/Biased Tone",
        description="Guide reads like marketing copy rather than objective research — superlatives without evidence.",
        stage="generation",
        severity="minor",
        fix_hint="Objectivity dimension in L2 judge should catch this",
        examples=[
            "'This incredible device will transform your workflow!'",
            "Uses brand taglines as if they were review conclusions",
        ],
    ),
    ErrorCategory(
        code="generation.wrong_audience",
        name="Wrong Audience Targeting",
        description="Recommendations don't match the user's stated needs, budget, or experience level.",
        stage="generation",
        severity="major",
        fix_hint="Actionability grader should check audience segmentation",
        examples=[
            "User asks for beginner espresso machine (<$200), gets $800 prosumer recommendations",
            "User asks for kid-friendly tablet, gets productivity tablets",
        ],
    ),

    # ── Format failures (output structure problems) ──
    ErrorCategory(
        code="format.no_comparison",
        name="Missing Comparison Table",
        description="Guide lists products without a side-by-side comparison table.",
        stage="format",
        severity="minor",
        fix_hint="Already checked by output_format grader — may need stronger prompt enforcement",
        examples=[
            "5 products described in paragraphs but no comparison table",
        ],
    ),
    ErrorCategory(
        code="format.no_purchase_path",
        name="No Purchase Path",
        description="Guide describes products but provides no prices, links, or where-to-buy information.",
        stage="format",
        severity="major",
        fix_hint="Actionability grader should enforce this — check threshold",
        examples=[
            "Detailed product comparison but zero prices and no purchase links",
            "'Available at major retailers' instead of specific links",
        ],
    ),
]

# Build lookup maps
TAXONOMY_BY_CODE = {cat.code: cat for cat in TAXONOMY}
TAXONOMY_BY_STAGE: dict[str, list[ErrorCategory]] = {}
for cat in TAXONOMY:
    TAXONOMY_BY_STAGE.setdefault(cat.stage, []).append(cat)

# Severity ordering for prioritization
SEVERITY_ORDER = {"critical": 0, "major": 1, "minor": 2}

# All valid codes (for validation)
VALID_CODES = set(TAXONOMY_BY_CODE.keys())


def classify_error_types(error_types: list[str]) -> list[dict]:
    """Map raw error_types from graders to taxonomy categories.

    Bridges the gap between grader-produced error_types (e.g., "no_inline_citations")
    and the structured taxonomy.
    """
    # Mapping from grader error_types to taxonomy codes
    ERROR_TYPE_MAP = {
        # Retrieval
        "low_search_coverage": "retrieval.insufficient_search",
        "irrelevant_searches": "retrieval.insufficient_search",
        "few_searches": "retrieval.insufficient_search",
        "missing_tool_group:search": "retrieval.insufficient_search",
        "low_dimension_coverage": "retrieval.insufficient_search",
        "no_authoritative_sources": "retrieval.missed_expert_source",
        "search_loops": "retrieval.search_loop",
        "excessive_searches": "retrieval.search_loop",

        # Extraction
        "no_sources": "extraction.phantom_citation",
        "majority_unverified_sources": "extraction.phantom_citation",
        "no_inline_citations": "extraction.phantom_citation",

        # Generation
        "no_pros_cons": "generation.missing_tradeoff",
        "constraint_violation": "generation.wrong_audience",

        # Format
        "no_comparison_table": "format.no_comparison",
        "guide_too_short": "format.no_purchase_path",
    }

    classified = []
    seen_codes: set[str] = set()

    for et in error_types:
        # Strip prefix like "missing_product:Sony Alpha 6700" → "missing_product"
        base_type = et.split(":")[0]

        code = ERROR_TYPE_MAP.get(base_type)
        if code and code not in seen_codes:
            seen_codes.add(code)
            cat = TAXONOMY_BY_CODE[code]
            classified.append({
                "code": code,
                "name": cat.name,
                "stage": cat.stage,
                "severity": cat.severity,
                "source_error_type": et,
            })

    # Sort by severity
    classified.sort(key=lambda x: SEVERITY_ORDER.get(x["severity"], 9))
    return classified


def get_taxonomy_summary() -> list[dict]:
    """Return the full taxonomy for display in the UI."""
    return [
        {
            "code": cat.code,
            "name": cat.name,
            "description": cat.description,
            "stage": cat.stage,
            "severity": cat.severity,
            "fix_hint": cat.fix_hint,
            "examples": cat.examples,
        }
        for cat in TAXONOMY
    ]


def prioritize_errors(classified_errors: list[dict]) -> list[dict]:
    """Prioritize classified errors by severity and frequency.

    Returns errors sorted: critical first, then major, then minor.
    Within same severity, sort by count (most frequent first).
    """
    from collections import Counter
    code_counts = Counter(e["code"] for e in classified_errors)

    # Deduplicate and annotate with count
    seen: set[str] = set()
    prioritized = []
    for e in classified_errors:
        if e["code"] not in seen:
            seen.add(e["code"])
            prioritized.append({
                **e,
                "count": code_counts[e["code"]],
            })

    prioritized.sort(key=lambda x: (
        SEVERITY_ORDER.get(x["severity"], 9),
        -x["count"],
    ))
    return prioritized
