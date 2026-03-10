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
