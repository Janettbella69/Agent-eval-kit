"""Deterministic code graders — zero LLM cost, instant execution.

Each grader takes a CollectedResult and optional golden_data/constraints,
returning a GraderResult with 0-100 score.
"""

import re
from collections import Counter
from difflib import SequenceMatcher
from urllib.parse import urlparse

from constants import TRUSTED_REVIEW_DOMAINS, DOMAIN_TO_TIER, TIER_SCORES
from graders.types import GraderResult
from runner.collector import CollectedResult


# ── Rubric Coverage ──────────────────────────────

def _extract_keywords(rubric_text: str) -> list[str]:
    """Extract technical keywords from rubric text for coverage checking."""
    # Common technical patterns: numbers with units, specific terms
    keywords = set()

    # Numbers with units (e.g., "4K", "500g", "30p", "10-bit", "30 hours")
    for m in re.finditer(r'\b\d+(?:\.\d+)?(?:\s*[-]?\s*(?:kg|g|mm|cm|hz|mhz|ghz|mp|fps|p|k|bit|hours?|hr|mins?|dB|cd|nit|lux|mAh|wh|watts?|W|inch|inches|"|lbs?|oz))\b', rubric_text, re.IGNORECASE):
        keywords.add(m.group().lower().strip())

    # Acronyms and tech terms (2+ uppercase chars or specific patterns)
    for m in re.finditer(r'\b[A-Z]{2,}[a-z]?\d*\b', rubric_text):
        keywords.add(m.group().lower())

    # Quoted terms
    for m in re.finditer(r"'([^']+)'|\"([^\"]+)\"", rubric_text):
        term = (m.group(1) or m.group(2)).lower()
        if len(term) > 2:
            keywords.add(term)

    # Key product-relevant nouns (filter common words)
    stop_words = {"the", "and", "for", "with", "that", "this", "from", "must", "should",
                  "have", "not", "are", "can", "will", "need", "also", "than", "more",
                  "less", "all", "any", "each", "has", "its", "was", "were", "been",
                  "being", "had", "but", "which", "their", "them", "they", "what",
                  "when", "where", "who", "how", "why", "product", "camera", "phone",
                  "customer", "user", "requirements", "therefore", "following", "conditions",
                  "meet", "ensure", "able", "required", "needs", "core", "key"}

    # Multi-word terms that appear between commas or semicolons
    segments = re.split(r'[,;•\n]', rubric_text)
    for seg in segments:
        seg = seg.strip().lower()
        if 3 < len(seg) < 60:
            words = seg.split()
            # Keep multi-word terms that have at least one non-stop word
            if len(words) >= 2 and any(w not in stop_words for w in words):
                # Take key phrases: 2-4 word combinations
                for i in range(len(words)):
                    for j in range(i + 2, min(i + 5, len(words) + 1)):
                        phrase = " ".join(words[i:j])
                        if any(w not in stop_words for w in words[i:j]):
                            keywords.add(phrase)

    return [k for k in keywords if len(k) > 1]


def grade_rubric_coverage(result: CollectedResult, golden_data: dict) -> GraderResult:
    """Text coverage: extract keywords from scene rubrics, check guide coverage."""
    scene_list = golden_data.get("scene_list", [])
    if not scene_list:
        return GraderResult(name="rubric_coverage", score=0, weight=0.20,
                            category="code", details={"skipped": True, "reason": "no scene_list"})

    all_keywords: list[str] = []
    for scene in scene_list:
        rubric = scene.get("rubric", "")
        if rubric:
            all_keywords.extend(_extract_keywords(rubric))

    if not all_keywords:
        return GraderResult(name="rubric_coverage", score=0, weight=0.20,
                            category="code", details={"skipped": True, "reason": "no keywords extracted"})

    guide_lower = result.guide_text.lower()
    hits = []
    misses = []
    seen = set()

    for kw in all_keywords:
        if kw in seen:
            continue
        seen.add(kw)
        if kw in guide_lower:
            hits.append(kw)
        else:
            misses.append(kw)

    total = len(hits) + len(misses)
    score = round(len(hits) / total * 100, 1) if total > 0 else 0

    error_types = [f"rubric_keyword_missing:{m}" for m in misses[:10]]

    return GraderResult(
        name="rubric_coverage", score=score, weight=0.20, category="code",
        details={"hits": len(hits), "total": total, "hit_examples": hits[:10], "miss_examples": misses[:10]},
        error_types=error_types,
    )


# ── Product Matching ─────────────────────────────

def _fuzzy_match(a: str, b: str, threshold: float = 0.6) -> bool:
    """Fuzzy string match using SequenceMatcher."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio() >= threshold


def grade_product_matching(result: CollectedResult, golden_data: dict) -> GraderResult:
    """Fuzzy product matching: compare found products vs golden products."""
    product_list = golden_data.get("product_list", [])
    if not product_list:
        return GraderResult(name="product_matching", score=0, weight=0.15,
                            category="code", details={"skipped": True, "reason": "no product_list"})

    golden_names = []
    for p in product_list:
        name = p.get("name", "") if isinstance(p, dict) else str(p)
        if name:
            golden_names.append(name)

    if not golden_names:
        return GraderResult(name="product_matching", score=0, weight=0.15,
                            category="code", details={"skipped": True, "reason": "no golden product names"})

    found_names = []
    for p in result.products:
        name = p.get("name", "") if isinstance(p, dict) else str(p)
        if name:
            found_names.append(name)

    # Also search guide text for product mentions
    guide_lower = result.guide_text.lower()

    matched_golden = set()
    matched_found = set()

    for gi, gn in enumerate(golden_names):
        for fi, fn in enumerate(found_names):
            if _fuzzy_match(gn, fn):
                matched_golden.add(gi)
                matched_found.add(fi)
                break
        else:
            # Check if golden product is mentioned in guide text
            if gn.lower() in guide_lower:
                matched_golden.add(gi)

    precision = len(matched_found) / len(found_names) if found_names else 0
    recall = len(matched_golden) / len(golden_names)
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    score = round(f1 * 100, 1)

    error_types = []
    for gi, gn in enumerate(golden_names):
        if gi not in matched_golden:
            error_types.append(f"missing_product:{gn}")

    return GraderResult(
        name="product_matching", score=score, weight=0.15, category="code",
        details={
            "golden_count": len(golden_names), "found_count": len(found_names),
            "matched": len(matched_golden), "precision": round(precision, 3),
            "recall": round(recall, 3), "f1": round(f1, 3),
        },
        error_types=error_types,
    )


# ── Source Quality ───────────────────────────────

def grade_source_quality(result: CollectedResult, golden_data: dict) -> GraderResult:
    """Source quality = T1/T2 ratio + reference URL overlap."""
    sources = result.sources
    if not sources:
        return GraderResult(name="source_quality", score=0, weight=0.10, category="code",
                            details={"no_sources": True}, error_types=["no_sources"])

    # T1/T2 ratio (40% of score)
    t1_t2_count = 0
    all_domains = set()
    for s in sources:
        url = s.get("url", "") if isinstance(s, dict) else ""
        if url:
            try:
                domain = urlparse(url).netloc.lower().lstrip("www.")
                all_domains.add(domain)
                if domain in TRUSTED_REVIEW_DOMAINS:
                    t1_t2_count += 1
            except Exception:
                pass

    t1_t2_ratio = t1_t2_count / len(sources) if sources else 0
    t1_t2_score = min(t1_t2_ratio / 0.3, 1.0)  # 30%+ trusted = full marks

    # Reference URL overlap (60% of score) — only if golden_data has references
    reference_urls = []
    if golden_data:
        for scene in golden_data.get("scene_list", []):
            ref = scene.get("reference", {})
            if isinstance(ref, dict):
                for url in ref.get("urls", []):
                    reference_urls.append(url)

    if reference_urls:
        ref_domains = set()
        for url in reference_urls:
            try:
                domain = urlparse(url).netloc.lower().lstrip("www.")
                if domain:
                    ref_domains.add(domain)
            except Exception:
                pass
        overlap = len(all_domains & ref_domains) / len(ref_domains) if ref_domains else 0
        ref_score = min(overlap / 0.5, 1.0)  # 50%+ overlap = full marks
        score = round((t1_t2_score * 0.4 + ref_score * 0.6) * 100, 1)
    else:
        # No reference URLs — use T1/T2 ratio + domain diversity
        diversity_score = min(len(all_domains) / 5, 1.0)  # 5+ domains = full marks
        score = round((t1_t2_score * 0.6 + diversity_score * 0.4) * 100, 1)

    error_types = []
    if t1_t2_count == 0:
        error_types.append("no_trusted_sources")
    if len(all_domains) < 3:
        error_types.append("low_source_diversity")

    return GraderResult(
        name="source_quality", score=score, weight=0.10, category="code",
        details={
            "t1_t2_count": t1_t2_count, "total_sources": len(sources),
            "unique_domains": len(all_domains), "t1_t2_ratio": round(t1_t2_ratio, 3),
        },
        error_types=error_types,
    )


# ── Source Authority ─────────────────────────────

def _get_domain_tier(domain: str) -> int:
    """Map a domain to its T1-T6 tier. Unknown domains default to T6."""
    domain = domain.lower().lstrip("www.")
    if domain in DOMAIN_TO_TIER:
        return DOMAIN_TO_TIER[domain]
    # Check subdomains (e.g., "uk.pcmag.com" → "pcmag.com")
    parts = domain.split(".")
    for i in range(1, len(parts)):
        parent = ".".join(parts[i:])
        if parent in DOMAIN_TO_TIER:
            return DOMAIN_TO_TIER[parent]
    return 6  # Unknown → T6 (SEO/unverified)


def grade_source_authority(result: CollectedResult, golden_data: dict) -> GraderResult:
    """Source authority: tier-weighted scoring based on T1-T6 credibility hierarchy.

    Score components:
    - Tier-weighted average (60%): higher tiers = higher score
    - T1/T2 presence (25%): at least 2 authoritative sources
    - Tier diversity (15%): sources span multiple tiers (well-rounded research)
    """
    sources = result.sources
    if not sources:
        return GraderResult(name="source_authority", score=0, weight=0.10, category="code",
                            details={"no_sources": True}, error_types=["no_sources"])

    tier_counts: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0}
    tier_examples: dict[int, list[str]] = {t: [] for t in range(1, 7)}
    tier_scores_list: list[float] = []

    for s in sources:
        url = s.get("url", "") if isinstance(s, dict) else ""
        if not url:
            continue
        try:
            domain = urlparse(url).netloc.lower().lstrip("www.")
            tier = _get_domain_tier(domain)
            tier_counts[tier] = tier_counts.get(tier, 0) + 1
            tier_scores_list.append(TIER_SCORES.get(tier, 10))
            if len(tier_examples[tier]) < 3:
                tier_examples[tier].append(domain)
        except Exception:
            tier_scores_list.append(10)
            tier_counts[6] = tier_counts.get(6, 0) + 1

    if not tier_scores_list:
        return GraderResult(name="source_authority", score=0, weight=0.10, category="code",
                            details={"no_parseable_sources": True}, error_types=["no_sources"])

    # Component 1: Tier-weighted average (60%)
    avg_tier_score = sum(tier_scores_list) / len(tier_scores_list)

    # Component 2: T1/T2 presence (25%) — want at least 2
    t1_t2 = tier_counts.get(1, 0) + tier_counts.get(2, 0)
    t1_t2_score = min(t1_t2 / 2, 1.0) * 100

    # Component 3: Tier diversity (15%) — sources from 3+ different tiers is ideal
    active_tiers = sum(1 for t, c in tier_counts.items() if c > 0)
    diversity_score = min(active_tiers / 3, 1.0) * 100

    score = round(avg_tier_score * 0.60 + t1_t2_score * 0.25 + diversity_score * 0.15, 1)

    error_types = []
    if t1_t2 == 0:
        error_types.append("no_authoritative_sources")
    if tier_counts.get(6, 0) > len(tier_scores_list) * 0.5:
        error_types.append("majority_unverified_sources")

    # Build readable tier breakdown
    tier_breakdown = {}
    for t in range(1, 7):
        if tier_counts.get(t, 0) > 0:
            tier_breakdown[f"T{t}"] = {
                "count": tier_counts[t],
                "examples": tier_examples[t],
            }

    return GraderResult(
        name="source_authority", score=score, weight=0.10, category="code",
        details={
            "tier_breakdown": tier_breakdown,
            "t1_t2_count": t1_t2,
            "total_sources": len(sources),
            "avg_tier_score": round(avg_tier_score, 1),
            "active_tiers": active_tiers,
        },
        error_types=error_types,
    )


# ── Output Format ────────────────────────────────

def grade_output_format(result: CollectedResult) -> GraderResult:
    """Output format quality: citations, table, pros/cons, guide length."""
    guide = result.guide_text
    error_types = []

    # Inline citations (30%)
    citation_count = len(re.findall(r'\[\[[^\]]+\]\]\(https?://[^\)]+\)', guide))
    citation_score = min(citation_count / 5, 1.0)  # 5+ citations = full marks
    if citation_count == 0:
        error_types.append("no_inline_citations")

    # Comparison table (20%)
    has_table = 1 if re.search(r'\|[^|]+\|[^|]+\|', guide) else 0
    if not has_table:
        error_types.append("no_comparison_table")

    # Pros/cons analysis (20%)
    pros_cons_markers = [
        r'(?i)\bpros?\b.*\bcons?\b', r'(?i)\badvantages?\b.*\bdisadvantages?\b',
        r'[✅✓].*[❌✗]', r'(?i)\bstrengths?\b.*\bweaknesses?\b',
        r'(?i)##.*(?:pros|cons|advantages|drawbacks)',
    ]
    has_pros_cons = 1 if any(re.search(p, guide[:10000]) for p in pros_cons_markers) else 0
    if not has_pros_cons:
        error_types.append("no_pros_cons")

    # Guide length (30%)
    guide_len = len(guide)
    if guide_len < 500:
        length_score = 0
        error_types.append("guide_too_short")
    elif guide_len < 3000:
        length_score = guide_len / 3000
    else:
        length_score = 1.0

    score = round((citation_score * 0.30 + has_table * 0.20 + has_pros_cons * 0.20 + length_score * 0.30) * 100, 1)

    return GraderResult(
        name="output_format", score=score, weight=0.10, category="code",
        details={
            "citation_count": citation_count, "has_table": bool(has_table),
            "has_pros_cons": bool(has_pros_cons), "guide_length": guide_len,
        },
        error_types=error_types,
    )


# ── Constraint Compliance ────────────────────────

def grade_constraint_compliance(result: CollectedResult, constraints: dict) -> GraderResult:
    """Constraint satisfaction rate. Reuses logic from l0_constraints."""
    if not constraints:
        return GraderResult(name="constraint_compliance", score=100, weight=0.05,
                            category="code", details={"no_constraints": True})

    from graders.l0_constraints import grade_constraints
    l0c = grade_constraints(result, constraints)
    c_score = l0c.get("constraint_score")

    if c_score is None:
        return GraderResult(name="constraint_compliance", score=100, weight=0.05,
                            category="code", details={"no_constraints": True})

    score = round(c_score * 100, 1)
    error_types = []
    if score < 70:
        error_types.append("constraint_violation")

    return GraderResult(
        name="constraint_compliance", score=score, weight=0.05, category="code",
        details={"constraint_score": c_score},
        error_types=error_types,
    )


# ── Efficiency ───────────────────────────────────

def grade_efficiency(result: CollectedResult) -> GraderResult:
    """Multi-factor efficiency: turn, token, and search efficiency."""
    hm = result.hook_metrics
    search_count = hm.get("search_count", 0)
    product_count = hm.get("product_count", 0) or len(result.products) or 1
    turn_count = hm.get("num_turns", 0) or result.turn_count or 0
    output_tokens = hm.get("output_tokens", 0) or result.output_tokens or 0

    # Turn efficiency (40%): under 15 turns = perfect, 40+ = low
    if turn_count <= 15:
        turn_score = 1.0
    elif turn_count <= 40:
        turn_score = 1.0 - (turn_count - 15) / 50
    else:
        turn_score = max(0.1, 1.0 - (turn_count - 15) / 50)

    # Token efficiency (30%): tokens per product — under 2k = great
    tokens_per_product = output_tokens / max(product_count, 1)
    if tokens_per_product <= 2000:
        token_score = 1.0
    elif tokens_per_product <= 5000:
        token_score = 1.0 - (tokens_per_product - 2000) / 6000
    else:
        token_score = max(0.1, 1.0 - (tokens_per_product - 2000) / 6000)

    # Search efficiency (30%): searches per product — under 3 = great
    searches_per_product = search_count / max(product_count, 1)
    if searches_per_product <= 3:
        search_score = 1.0
    elif searches_per_product <= 8:
        search_score = 1.0 - (searches_per_product - 3) / 10
    else:
        search_score = max(0.1, 1.0 - (searches_per_product - 3) / 10)

    score = round((turn_score * 0.40 + token_score * 0.30 + search_score * 0.30) * 100, 1)

    error_types = []
    if turn_count > 40:
        error_types.append("excessive_turns")
    if tokens_per_product > 5000:
        error_types.append("verbose_output")
    if searches_per_product > 8:
        error_types.append("excessive_searches")

    return GraderResult(
        name="efficiency", score=score, weight=0.05, category="code",
        details={
            "turn_count": turn_count, "tokens_per_product": round(tokens_per_product, 0),
            "searches_per_product": round(searches_per_product, 1),
            "search_count": search_count, "product_count": product_count,
        },
        error_types=error_types,
    )


# ── Tool Calls ──────────────────────────────────

# Tool groups that a shopping research agent should use
REQUIRED_TOOL_PATTERNS = [
    {
        "group": "search",
        "tools": ["WebSearch", "brave_web_search", "search", "tavily_search", "exa_search"],
        "min_calls": 2,
        "description": "at least 2 searches",
    },
    {
        "group": "fetch",
        "tools": ["WebFetch", "firecrawl_scrape", "tavily_extract", "tavily_crawl"],
        "min_calls": 1,
        "description": "at least 1 page fetch",
    },
]


def _count_tool_group(tool_names: list[str], group_tools: list[str]) -> int:
    """Count how many times tools from a group were called."""
    group_lower = {t.lower() for t in group_tools}
    return sum(1 for t in tool_names if t.lower() in group_lower)


def _detect_duplicate_fetches(events: list[dict]) -> int:
    """Count duplicate URL fetches from event stream."""
    fetched_urls: list[str] = []
    for ev in events:
        if ev.get("type") == "search_progress" and ev.get("phase") == "fetch":
            url = ev.get("query", "")
            if url:
                fetched_urls.append(url)
    return len(fetched_urls) - len(set(fetched_urls))


def _check_query_relevance(events: list[dict], case_query: str) -> float:
    """Check if search queries are relevant to the case query (Jaccard similarity)."""
    case_words = set(case_query.lower().split())
    if not case_words:
        return 1.0

    relevant = 0
    total = 0
    for ev in events:
        if ev.get("type") == "search_progress" and ev.get("phase") in ("search", "searching"):
            query = ev.get("query", "")
            if query:
                total += 1
                query_words = set(query.lower().split())
                intersection = case_words & query_words
                if len(intersection) / max(len(case_words), 1) >= 0.2:
                    relevant += 1

    return relevant / max(total, 1)


def grade_tool_calls(result: CollectedResult, case_query: str = "") -> GraderResult:
    """Validate required tool usage patterns + parameter constraints.

    Dimensions:
    - Required tool coverage (30%): each required group present
    - No duplicate waste (15%): no repeated URL fetches
    - Query relevance (20%): search queries relate to case query
    - Tool diversity (15%): 3+ different tool types
    - Parallel execution (10%): used parallel batches
    - Error recovery (10%): low failure rate
    """
    hm = result.hook_metrics
    tool_names = result.tool_names or []
    events = result.events or []

    # Required tool coverage (30%)
    patterns_met = 0
    pattern_details = {}
    for pat in REQUIRED_TOOL_PATTERNS:
        count = _count_tool_group(tool_names, pat["tools"])
        met = count >= pat["min_calls"]
        patterns_met += int(met)
        pattern_details[pat["group"]] = {"count": count, "required": pat["min_calls"], "met": met}
    coverage_score = patterns_met / max(len(REQUIRED_TOOL_PATTERNS), 1)

    # No duplicate waste (15%)
    dup_count = _detect_duplicate_fetches(events)
    dup_score = 1.0 if dup_count == 0 else max(0, 1.0 - dup_count * 0.25)

    # Query relevance (20%)
    relevance_score = _check_query_relevance(events, case_query)

    # Tool diversity (15%): unique tool types
    unique_tools = len(set(t.lower() for t in tool_names))
    diversity_score = min(unique_tools / 3, 1.0)

    # Parallel execution (10%)
    avg_batch = hm.get("avg_batch_size", 0)
    parallel_score = min(avg_batch / 2, 1.0) if avg_batch > 0 else 0

    # Error recovery (10%)
    tool_call_count = hm.get("tool_call_count", 0) or len(tool_names) or 1
    failure_count = hm.get("failure_count", 0)
    error_rate = failure_count / max(tool_call_count, 1)
    error_score = 1.0 if error_rate < 0.1 else max(0, 1.0 - error_rate)

    score = round((
        coverage_score * 0.30 +
        dup_score * 0.15 +
        relevance_score * 0.20 +
        diversity_score * 0.15 +
        parallel_score * 0.10 +
        error_score * 0.10
    ) * 100, 1)

    error_types = []
    for pat in REQUIRED_TOOL_PATTERNS:
        if not pattern_details[pat["group"]]["met"]:
            error_types.append(f"missing_tool_group:{pat['group']}")
    if dup_count > 0:
        error_types.append(f"duplicate_fetches:{dup_count}")
    if relevance_score < 0.5:
        error_types.append("irrelevant_searches")

    return GraderResult(
        name="tool_calls", score=score, weight=0.05, category="code",
        details={
            "patterns": pattern_details,
            "duplicate_fetches": dup_count,
            "query_relevance": round(relevance_score, 2),
            "unique_tools": unique_tools,
            "avg_batch_size": avg_batch,
            "error_rate": round(error_rate, 3),
        },
        error_types=error_types,
    )


# ── Transcript ──────────────────────────────────

def _detect_search_loops(events: list[dict]) -> int:
    """Detect consecutive searches that find 0 new entities.

    A "loop" is 3+ consecutive search events where entity_count doesn't increase.
    """
    search_events = [
        ev for ev in events
        if ev.get("type") == "search_progress" and ev.get("phase") in ("search", "searching")
    ]
    if len(search_events) < 3:
        return 0

    # Track entity counts from hook_metrics snapshots in events
    loops = 0
    stale_streak = 0
    last_entity_count = 0

    for ev in events:
        if ev.get("type") == "search_progress":
            cur_entities = ev.get("count", 0)  # product count at this point
            if cur_entities <= last_entity_count:
                stale_streak += 1
            else:
                stale_streak = 0
                last_entity_count = cur_entities

            if stale_streak >= 3:
                loops += 1
                stale_streak = 0  # reset after detecting one loop

    return loops


def grade_transcript(result: CollectedResult) -> GraderResult:
    """Evaluate conversation flow: turn limits, search loops, completeness, dimension coverage.

    Checks:
    - within_turn_limit: didn't exceed max turns
    - no_search_loops: no 3+ consecutive searches with 0 progress
    - completed_research: agent finished normally (not max_turns_exceeded)
    - dimension_coverage: explored 4+ of 6 research dimensions
    """
    hm = result.hook_metrics
    max_turns = hm.get("max_turns", 35)
    turn_count = hm.get("num_turns", 0) or result.turn_count or 0
    dims_explored = hm.get("dimensions_explored", 0)

    checks = {}

    # Turn limit
    checks["within_turn_limit"] = turn_count <= max_turns

    # Search loops
    loop_count = _detect_search_loops(result.events)
    checks["no_search_loops"] = loop_count == 0

    # Completed research (not cut off)
    has_guide = len(result.guide_text) > 200
    has_products = len(result.products) >= 1
    checks["completed_research"] = has_guide and has_products

    # Dimension coverage (at least 4/6)
    checks["dimension_coverage"] = dims_explored >= 4

    passed = sum(checks.values())
    total = len(checks)
    score = round(passed / total * 100, 1)

    error_types = []
    if not checks["within_turn_limit"]:
        error_types.append(f"exceeded_turn_limit:{turn_count}/{max_turns}")
    if loop_count > 0:
        error_types.append(f"search_loops:{loop_count}")
    if not checks["completed_research"]:
        error_types.append("incomplete_research")
    if not checks["dimension_coverage"]:
        error_types.append(f"low_dimension_coverage:{dims_explored}/6")

    return GraderResult(
        name="transcript", score=score, weight=0.05, category="code",
        details={
            "checks": checks,
            "turn_count": turn_count,
            "max_turns": max_turns,
            "search_loops": loop_count,
            "dimensions_explored": dims_explored,
        },
        error_types=error_types,
    )


# ── State Check ─────────────────────────────────

def grade_state_check(result: CollectedResult) -> GraderResult:
    """Verify agent end-state assertions — did it produce a complete result?

    Expectations:
    - products_found: at least 3 products
    - guide_generated: guide text > 500 chars
    - sources_collected: at least 3 sources
    - no_unresolved_errors: 0 error events
    - entities_discovered: at least 2 entities found during research
    """
    hm = result.hook_metrics

    expectations = {
        "products_found": len(result.products) >= 3,
        "guide_generated": len(result.guide_text) > 500,
        "sources_collected": len(result.sources) >= 3,
        "no_unresolved_errors": len(result.error_events) == 0,
        "entities_discovered": hm.get("entity_count", 0) >= 2,
    }

    passed = sum(expectations.values())
    total = len(expectations)
    score = round(passed / total * 100, 1)

    error_types = []
    if not expectations["products_found"]:
        error_types.append(f"few_products:{len(result.products)}")
    if not expectations["guide_generated"]:
        error_types.append(f"short_guide:{len(result.guide_text)}")
    if not expectations["sources_collected"]:
        error_types.append(f"few_sources:{len(result.sources)}")
    if not expectations["no_unresolved_errors"]:
        error_types.append(f"errors:{len(result.error_events)}")
    if not expectations["entities_discovered"]:
        error_types.append(f"few_entities:{hm.get('entity_count', 0)}")

    return GraderResult(
        name="state_check", score=score, weight=0.05, category="code",
        details={"expectations": expectations},
        error_types=error_types,
    )
