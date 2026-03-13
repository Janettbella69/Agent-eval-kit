"""Independent copy of domain/category constants from product backend.

These are duplicated (not imported) to maintain zero coupling with backend/.
"""

TRUSTED_REVIEW_DOMAINS = {
    "rtings.com", "wirecutter.com", "tomshardware.com", "notebookcheck.net",
    "cnet.com", "techradar.com", "gsmarena.com", "soundguys.com", "tomsguide.com",
    "theverge.com", "pcmag.com", "dxomark.com",
    "audiosciencereview.com", "tftcentral.co.uk", "dcrainmaker.com",
    "laptopmag.com", "phonearena.com", "petapixel.com", "wareable.com", "displayninja.com",
}

TRUSTED_SHOPPING_DOMAINS = {
    "amazon.com", "bestbuy.com", "walmart.com", "newegg.com", "bhphotovideo.com",
}

TRUSTED_COMMUNITY_DOMAINS = {
    "reddit.com",
}

# ── Source Authority Tiers (T1-T6) ─────────────────────────────
# Based on CLAUDE.md source credibility hierarchy.
# T1: Measurement-based reviews, T2: Editorial reviews, T3: Community consensus,
# T4: Individual user reports, T5: Brand promotional, T6: SEO listicles

SOURCE_TIER_DOMAINS: dict[int, set[str]] = {
    1: {  # T1: Measurement-based reviews
        "rtings.com", "notebookcheck.net", "dxomark.com", "audiosciencereview.com",
        "tftcentral.co.uk", "gamersnexus.net", "anandtech.com",
    },
    2: {  # T2: Editorial reviews
        "wirecutter.com", "tomshardware.com", "tomsguide.com", "cnet.com",
        "techradar.com", "laptopmag.com", "pcmag.com", "soundguys.com",
        "theverge.com", "gsmarena.com", "phonearena.com", "petapixel.com",
        "displayninja.com", "dpreview.com", "consumerreports.org",
        "dcrainmaker.com", "wareable.com", "thespruce.com",
        "dong-knows-tech.com", "smallnetbuilder.com",
    },
    3: {  # T3: Community consensus (needs high engagement)
        "reddit.com", "head-fi.org", "avsforum.com", "quora.com",
    },
    4: {  # T4: Shopping / price comparison (factual data)
        "amazon.com", "bestbuy.com", "newegg.com", "walmart.com",
        "bhphotovideo.com", "shopzilla.com", "pricegrabber.com",
        "pricerunner.com",
    },
    5: {  # T5: Brand / manufacturer sites
        # Detected dynamically — any domain matching brand/manufacturer patterns
    },
}

# Reverse lookup: domain → tier
DOMAIN_TO_TIER: dict[str, int] = {}
for _tier, _domains in SOURCE_TIER_DOMAINS.items():
    for _d in _domains:
        DOMAIN_TO_TIER[_d] = _tier

# Tier scores (0-100 scale for weighted average)
TIER_SCORES = {1: 100, 2: 80, 3: 60, 4: 50, 5: 20, 6: 10}

CATEGORY_KEYWORDS = {
    "gaming_laptop": ["gaming laptop", "gaming notebook"],
    "earbuds": ["earbud", "earphone", "airpod", "iem", "tws", "true wireless"],
    "robot_vacuum": ["robot vacuum", "roomba", "roborock", "vacuum cleaner"],
    "headphones": ["headphone", "headset", "over-ear", "on-ear"],
    "laptop": ["laptop", "notebook", "macbook", "chromebook", "ultrabook"],
    "camera": ["camera", "dslr", "mirrorless", "gopro", "webcam", "camcorder"],
    "phone": ["phone", "smartphone", "iphone", "android", "galaxy", "pixel"],
    "tv": ["tv", "television", "oled tv", "qled"],
    "monitor": ["monitor", "display", "screen"],
    "speaker": ["speaker", "soundbar", "subwoofer", "bluetooth speaker", "home theater"],
    "tablet": ["tablet", "ipad", "surface"],
    "keyboard": ["keyboard", "mechanical keyboard", "keycaps"],
    "mouse": ["mouse", "trackpad", "trackball"],
    "watch": ["watch", "smartwatch", "fitness tracker", "garmin", "apple watch"],
}
