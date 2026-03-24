"""Retrieval quality grader — evaluates search/fetch quality independently.

Based on Hamel Husain's evaluate-rag skill:
  "Do error analysis on end-to-end traces first. Determine whether failures
   come from retrieval, generation, or both."

This grader measures whether the agent's search strategy found the right
information, regardless of how well it synthesized that information.

Dimensions:
1. Search coverage: Did searches cover the key aspects of the query?
2. Source relevance: Are fetched sources relevant to the query topic?
3. Product discovery: Did the agent find products matching the user's needs?
4. Search efficiency: Ratio of productive searches to total searches
"""

import re
from urllib.parse import urlparse

from graders.types import GraderResult
from runner.collector import CollectedResult


def _extract_search_queries(events: list[dict]) -> list[str]:
    """Extract unique search queries from event stream."""
    queries = []
    seen = set()
    for ev in events:
        if ev.get("type") == "search_progress":
            q = ev.get("query", ev.get("phase", ""))
            if q and q not in seen:
                queries.append(q)
                seen.add(q)
    return queries


def _extract_fetched_urls(events: list[dict]) -> list[str]:
    """Extract URLs that were fetched during research."""
    urls = []
    for ev in events:
        if ev.get("type") == "search_progress" and ev.get("phase") == "fetch":
            url = ev.get("query", "")
            if url and url.startswith("http"):
                urls.append(url)
    return urls


def _query_aspect_coverage(search_queries: list[str], user_query: str) -> float:
    """Measure how many aspects of the user query were covered by searches.

    Extracts noun phrases / key terms from the user query, then checks
    how many appear (or have synonyms) in the search queries.
    """
    if not user_query or not search_queries:
        return 0.0

    # Extract key terms from user query (words > 3 chars, excluding stop words)
    stop_words = {
        "best", "good", "great", "nice", "what", "which", "that", "this",
        "with", "from", "have", "need", "want", "looking", "find", "recommend",
        "under", "over", "around", "about", "like", "some", "most", "very",
        "should", "could", "would", "also", "just", "more", "less", "than",
        "please", "help", "tell", "give", "show",
    }

    query_terms = set()
    for word in re.findall(r'\b\w+\b', user_query.lower()):
        if len(word) > 3 and word not in stop_words:
            query_terms.add(word)

    if not query_terms:
        return 1.0  # Very short query — any search counts

    # Check coverage: which query terms appear in search queries?
    all_searches = " ".join(search_queries).lower()
    covered = sum(1 for term in query_terms if term in all_searches)

    return covered / len(query_terms)


def _source_topic_relevance(sources: list, user_query: str) -> float:
    """Score how topically relevant the sources are to the user query.

    Uses domain matching + title keyword overlap.
    """
    if not sources or not user_query:
        return 0.0

    query_words = set(re.findall(r'\b\w{4,}\b', user_query.lower()))
    if not query_words:
        return 0.5  # Can't assess

    relevant_count = 0
    for s in sources:
        if not isinstance(s, dict):
            continue
        title = (s.get("title", "") or "").lower()
        # A source is "relevant" if title shares 2+ words with query
        title_words = set(re.findall(r'\b\w{4,}\b', title))
        overlap = query_words & title_words
        if len(overlap) >= 1:
            relevant_count += 1

    return relevant_count / len(sources) if sources else 0.0


def _search_productivity(events: list[dict], products: list, sources: list) -> float:
    """Ratio of searches that contributed to finding products/sources.

    A "productive" search is one after which the product count or source count increased.
    """
    search_events = [
        ev for ev in events
        if ev.get("type") == "search_progress" and ev.get("phase") in ("search", "searching")
    ]

    if not search_events:
        return 0.0

    # Track product count progression
    product_counts = []
    for ev in events:
        if ev.get("type") == "product_preview":
            product_counts.append(ev.get("count", 0))
        elif ev.get("type") == "product_found":
            product_counts.append(len(product_counts) + 1)

    total_searches = len(search_events)
    total_products = len(products)
    total_sources = len(sources)

    # Heuristic: if we have good output, searches were productive
    if total_products >= 3 and total_sources >= 3:
        # Penalize if too many searches for the output
        efficiency = min(1.0, (total_products + total_sources) / (total_searches * 2))
        return max(0.3, efficiency)  # Floor at 0.3 if output is decent

    if total_products == 0 and total_sources == 0:
        return 0.0

    return min(1.0, (total_products + total_sources) / max(total_searches, 1))


def grade_retrieval_quality(result: CollectedResult, case_query: str = "") -> GraderResult:
    """Evaluate retrieval quality: did the agent's searches find the right information?

    This grader measures the SEARCH phase independently of the GENERATION phase.
    A trace can have good retrieval but poor generation (or vice versa).

    Components (weighted):
    - Search aspect coverage (30%): Did searches cover key query aspects?
    - Source topic relevance (25%): Are sources on-topic?
    - Product discovery rate (25%): Products found per search effort
    - Search efficiency (20%): Productive vs wasted searches
    """
    events = result.events or []
    search_queries = _extract_search_queries(events)
    query = case_query or ""

    error_types = []

    # Component 1: Search aspect coverage (30%)
    coverage = _query_aspect_coverage(search_queries, query)
    if coverage < 0.3:
        error_types.append("low_search_coverage")

    # Component 2: Source topic relevance (25%)
    relevance = _source_topic_relevance(result.sources, query)
    if relevance < 0.3:
        error_types.append("irrelevant_sources")

    # Component 3: Product discovery rate (25%)
    n_products = len(result.products)
    n_searches = len(search_queries) or 1
    # Expect at least 3 products; more searches should yield more
    if n_products >= 5:
        discovery = 1.0
    elif n_products >= 3:
        discovery = 0.7 + (n_products - 3) * 0.15
    elif n_products >= 1:
        discovery = 0.3 + (n_products - 1) * 0.2
    else:
        discovery = 0.0
        error_types.append("no_products_discovered")

    # Component 4: Search efficiency (20%)
    efficiency = _search_productivity(events, result.products, result.sources)
    if efficiency < 0.2:
        error_types.append("inefficient_searches")

    score = round((
        coverage * 0.30 +
        relevance * 0.25 +
        discovery * 0.25 +
        efficiency * 0.20
    ) * 100, 1)

    # Diagnose: is the problem retrieval, generation, or both?
    diagnosis = "unknown"
    if score >= 70 and len(result.guide_text) < 500:
        diagnosis = "good_retrieval_poor_generation"
    elif score < 50 and len(result.guide_text) > 2000:
        diagnosis = "poor_retrieval_decent_generation"  # Possible hallucination
    elif score >= 70:
        diagnosis = "retrieval_ok"
    else:
        diagnosis = "retrieval_problem"

    return GraderResult(
        name="retrieval_quality",
        score=score,
        weight=0.08,  # Will be overridden by effective_weights
        category="code",
        details={
            "search_coverage": round(coverage, 3),
            "source_relevance": round(relevance, 3),
            "product_discovery": round(discovery, 3),
            "search_efficiency": round(efficiency, 3),
            "n_searches": len(search_queries),
            "n_products": n_products,
            "n_sources": len(result.sources),
            "diagnosis": diagnosis,
            "search_queries_sample": search_queries[:10],
        },
        error_types=error_types,
    )
