"""Search query quality grader — evaluates the agent's search strategy.

Per Coze Loop "工具参数正确性": evaluates whether the agent constructed
good search queries, not just whether it searched enough times.

Dimensions:
- Diversity: Are queries varied (not repetitive)?
- Specificity: Targeted queries (product names, specs) vs generic ("best X")?
- Expert source targeting: Did agent search for authoritative review sites?
- Relevance: Do queries relate to the user's original intent?
"""

import re
from collections import Counter
from difflib import SequenceMatcher

from graders.types import GraderResult
from runner.collector import CollectedResult

# Expert review domains that indicate high-quality search strategy
EXPERT_DOMAINS = {
    "rtings", "wirecutter", "notebookcheck", "tomshardware", "soundguys",
    "dpreview", "gsmarena", "cnet", "techradar", "consumerreports",
    "dxomark", "audiosciencereview", "gamersnexus", "displayninja",
}


def _extract_search_queries(result: CollectedResult) -> list[str]:
    """Extract search queries from SSE events."""
    queries = []
    for event in result.events:
        if event.get("type") == "search_progress":
            q = event.get("query", "")
            if q and q not in ("Analyzing your query...", "Preparing search tools..."):
                queries.append(q)
    return queries


def _score_diversity(queries: list[str]) -> float:
    """Score query diversity: penalize near-duplicate searches."""
    if len(queries) <= 1:
        return 50.0

    duplicates = 0
    for i in range(len(queries)):
        for j in range(i + 1, len(queries)):
            similarity = SequenceMatcher(None, queries[i].lower(), queries[j].lower()).ratio()
            if similarity > 0.8:
                duplicates += 1

    total_pairs = len(queries) * (len(queries) - 1) / 2
    duplicate_ratio = duplicates / total_pairs if total_pairs > 0 else 0
    return max(0, 100 * (1 - duplicate_ratio * 2))


def _score_specificity(queries: list[str]) -> float:
    """Score query specificity: specific product/brand/spec queries score higher."""
    if not queries:
        return 0.0

    specific_count = 0
    for q in queries:
        q_lower = q.lower()
        # Specific indicators: brand names, model numbers, specs, "vs", price ranges
        has_brand = bool(re.search(r'[A-Z][a-z]+\s+[A-Z]', q))  # CamelCase brand
        has_model = bool(re.search(r'[A-Z0-9]{2,}[-/][A-Z0-9]+', q))  # Model numbers
        has_spec = bool(re.search(r'\d+\s*(gb|tb|mah|hz|inch|mm|mp|fps|w)\b', q_lower))
        has_comparison = 'vs' in q_lower or 'versus' in q_lower or 'compare' in q_lower
        has_price = bool(re.search(r'\$\d+|under \d+|budget', q_lower))
        has_site = bool(re.search(r'site:|reddit|rtings|wirecutter|review', q_lower))

        if sum([has_brand, has_model, has_spec, has_comparison, has_price, has_site]) >= 1:
            specific_count += 1

    return (specific_count / len(queries)) * 100


def _score_expert_targeting(queries: list[str]) -> float:
    """Score whether agent targeted expert review sources."""
    if not queries:
        return 0.0

    expert_hits = 0
    for q in queries:
        q_lower = q.lower()
        for domain in EXPERT_DOMAINS:
            if domain in q_lower:
                expert_hits += 1
                break

    # Bonus for targeting expert sources, but don't require it for every query
    if expert_hits >= 2:
        return 100.0
    elif expert_hits == 1:
        return 60.0
    else:
        return 20.0


def grade_search_quality(result: CollectedResult, original_query: str = "") -> GraderResult:
    """Evaluate the quality of the agent's search queries.

    Combines diversity, specificity, and expert source targeting.
    """
    queries = _extract_search_queries(result)

    if not queries:
        return GraderResult(
            name="search_quality", score=0, weight=0.05,
            category="code",
            details={"query_count": 0, "reason": "no searches performed"},
        )

    diversity = _score_diversity(queries)
    specificity = _score_specificity(queries)
    expert = _score_expert_targeting(queries)

    # Weighted combination: specificity matters most
    score = diversity * 0.3 + specificity * 0.4 + expert * 0.3
    score = round(min(100, max(0, score)), 1)

    error_types = []
    if diversity < 40:
        error_types.append("retrieval.search_loop")
    if specificity < 30:
        error_types.append("retrieval.generic_queries")
    if expert < 30:
        error_types.append("retrieval.missed_expert_source")

    return GraderResult(
        name="search_quality",
        score=score,
        weight=0.05,
        category="code",
        details={
            "query_count": len(queries),
            "diversity": round(diversity, 1),
            "specificity": round(specificity, 1),
            "expert_targeting": round(expert, 1),
            "queries_sample": queries[:5],
        },
        error_types=error_types,
    )
