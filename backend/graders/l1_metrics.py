"""L1 metrics grader: 13 scoring rules ported from eval_runner.py.

Continuous scoring with partial credit based on ratio to threshold.
"""

import re
from urllib.parse import urlparse

from constants import TRUSTED_REVIEW_DOMAINS
from runner.collector import CollectedResult

# ── Scoring Rules ─────────────────────────────────
# (metric_name, threshold, weight, comparison)

SCORING_RULES = [
    ("product_count",         3,    10, "gte"),
    ("source_count",          5,    10, "gte"),
    ("guide_length",          3000, 10, "gte"),
    ("entity_count",          3,     7, "gte"),
    ("dimensions_explored",   3,     7, "gte"),
    ("source_domain_count",   3,     7, "gte"),
    ("has_prices",            1,     7, "gte"),
    ("no_error",              1,    10, "gte"),
    ("citation_count",        3,     8, "gte"),
    ("price_coverage",        0.5,   6, "gte"),
    ("t1_t2_source_count",    2,     6, "gte"),
    ("has_comparison_table",  1,     6, "gte"),
    ("has_pros_cons",         1,     6, "gte"),
]

TYPE_SCORING_OVERRIDES: dict[str, dict[str, int]] = {
    "comparison": {
        "product_count": 2,
        "entity_count": 2,
    },
}

NEGATIVE_TYPES = {"negative"}


# ── Helper functions ──────────────────────────────

def _count_priced_products(products: list) -> int:
    count = 0
    for p in products:
        price = p.get("price", "") if isinstance(p, dict) else ""
        if price and str(price).strip() and str(price).strip() != "N/A":
            count += 1
    return count


def _count_source_domains(sources: list) -> int:
    domains = set()
    for s in sources:
        url = s.get("url", "") if isinstance(s, dict) else ""
        if url:
            try:
                domain = urlparse(url).netloc.lower().lstrip("www.")
                if domain:
                    domains.add(domain)
            except Exception:
                pass
    return len(domains)


def _count_citations(guide_text: str) -> int:
    """Count inline citations: [[Source]](url) pattern."""
    return len(re.findall(r'\[\[[^\]]+\]\]\(https?://[^\)]+\)', guide_text))


def _count_t1_t2_sources(sources: list) -> int:
    count = 0
    for s in sources:
        url = s.get("url", "") if isinstance(s, dict) else ""
        if url:
            try:
                domain = urlparse(url).netloc.lower().lstrip("www.")
                if domain in TRUSTED_REVIEW_DOMAINS:
                    count += 1
            except Exception:
                pass
    return count


def _has_comparison_table(guide_text: str) -> int:
    return 1 if re.search(r'\|[^|]+\|[^|]+\|', guide_text) else 0


def _has_pros_cons(guide_text: str) -> int:
    markers = [
        r'(?i)\bpros?\b.*\bcons?\b',
        r'(?i)\badvantages?\b.*\bdisadvantages?\b',
        r'[✅✓].*[❌✗]',
        r'(?i)\bstrengths?\b.*\bweaknesses?\b',
        r'(?i)##.*(?:pros|cons|advantages|drawbacks)',
    ]
    text_sample = guide_text[:10000]
    return 1 if any(re.search(p, text_sample) for p in markers) else 0


# ── Negative case scoring ─────────────────────────

def _score_negative_case(result: CollectedResult) -> tuple[int, dict]:
    """High score = correctly didn't do full research."""
    score = 100
    breakdown = {}

    n_products = len(result.products)
    if n_products > 0:
        penalty = min(n_products * 15, 50)
        score -= penalty
        breakdown["products_found"] = {"penalty": penalty, "count": n_products}

    guide_len = len(result.guide_text)
    if guide_len > 2000:
        penalty = min((guide_len - 2000) // 500 * 5, 25)
        score -= penalty
        breakdown["guide_too_long"] = {"penalty": penalty, "chars": guide_len}

    searches = result.hook_metrics.get("search_count", 0)
    if searches > 3:
        penalty = min((searches - 3) * 5, 25)
        score -= penalty
        breakdown["too_many_searches"] = {"penalty": penalty, "count": searches}

    return max(0, score), breakdown


# ── Main scoring function ─────────────────────────

def compute_l1_score(result: CollectedResult, case_type: str) -> tuple[int, dict]:
    """Compute L1 automated score (0-100).

    Returns (score, breakdown_dict).
    """
    if case_type in NEGATIVE_TYPES:
        return _score_negative_case(result)

    priced = _count_priced_products(result.products)
    total_products = len(result.products)

    metrics = {
        "product_count": total_products,
        "source_count": len(result.sources),
        "guide_length": len(result.guide_text),
        "entity_count": result.hook_metrics.get("entity_count", 0),
        "dimensions_explored": result.hook_metrics.get("dimensions_explored", 0),
        "source_domain_count": max(
            result.hook_metrics.get("source_domain_count", 0),
            _count_source_domains(result.sources),
        ),
        "has_prices": priced,
        "no_error": 1 if len(result.error_events) == 0 else 0,
        "citation_count": _count_citations(result.guide_text),
        "price_coverage": (priced / total_products) if total_products > 0 else 0.0,
        "t1_t2_source_count": _count_t1_t2_sources(result.sources),
        "has_comparison_table": _has_comparison_table(result.guide_text),
        "has_pros_cons": _has_pros_cons(result.guide_text),
    }

    overrides = TYPE_SCORING_OVERRIDES.get(case_type, {})

    total = 0
    breakdown: dict = {}
    for metric_name, threshold, weight, comparison in SCORING_RULES:
        effective_threshold = overrides.get(metric_name, threshold)
        value = metrics.get(metric_name, 0)
        if comparison == "gte" and effective_threshold > 0:
            ratio = min(value / effective_threshold, 1.0)
        else:
            ratio = 1.0 if value > 0 else 0.0
        earned = round(ratio * weight)
        breakdown[metric_name] = {
            "value": value,
            "threshold": effective_threshold,
            "earned": earned,
            "weight": weight,
            "ratio": round(ratio, 2),
        }
        total += earned

    return total, breakdown
