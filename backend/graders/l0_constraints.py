"""L0 constraint grader: checks products against user constraints."""

import re

from runner.collector import CollectedResult


def _parse_price(price_str: str) -> float | None:
    """Extract numeric price from string like '$99.99', '99.99 USD', etc."""
    if not price_str:
        return None
    match = re.search(r'[\d,]+(?:\.\d{1,2})?', str(price_str).replace(",", ""))
    if match:
        try:
            return float(match.group())
        except ValueError:
            return None
    return None


def grade_constraints(result: CollectedResult, constraints: dict) -> dict:
    """Check products against explicit constraints.

    Supported constraints:
        price_max: float — all products should be <= this price
        price_min: float — all products should be >= this price
        rating_min: float — all products should have rating >= this
        brand: str — at least one product should match this brand

    Returns:
        {"constraint_score": float 0-1 or None if no constraints}
    """
    if not constraints:
        return {"constraint_score": None}

    checks: list[bool] = []

    price_max = constraints.get("price_max")
    price_min = constraints.get("price_min")
    rating_min = constraints.get("rating_min")
    brand = constraints.get("brand", "").lower()

    for product in result.products:
        price = _parse_price(product.get("price", ""))

        if price_max is not None and price is not None:
            checks.append(price <= float(price_max))

        if price_min is not None and price is not None:
            checks.append(price >= float(price_min))

        if rating_min is not None:
            rating_str = product.get("rating", "")
            if rating_str:
                rating_match = re.search(r'[\d.]+', str(rating_str))
                if rating_match:
                    try:
                        rating = float(rating_match.group())
                        checks.append(rating >= float(rating_min))
                    except ValueError:
                        pass

    if brand:
        brand_found = any(
            brand in product.get("brand", "").lower() or
            brand in product.get("name", "").lower()
            for product in result.products
        )
        checks.append(brand_found)

    # must_have: keywords that should appear in guide text or product descriptions
    must_have = constraints.get("must_have", [])
    if must_have and isinstance(must_have, list):
        # Build searchable text from guide + product names/descriptions
        searchable = result.guide_text.lower()
        for product in result.products:
            searchable += " " + product.get("name", "").lower()
            searchable += " " + product.get("description", "").lower()

        for keyword in must_have:
            # Normalize: "30+" → "30", "40+" → "40" (strip + after digits)
            kw_lower = keyword.lower()
            kw_core = re.sub(r'(\d)\+', r'\1', kw_lower).strip()
            checks.append(kw_core in searchable)

    if not checks:
        return {"constraint_score": None}

    score = sum(checks) / len(checks)
    return {"constraint_score": round(score, 3)}
