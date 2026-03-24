"""ShoppingComp JSONL dataset importer.

Handles two formats:
  - ShoppingComp_97: Main cases with scene_list + product_list
  - ShoppingComp_traps: Trap cases with trap_rubric

Each JSONL line has:
  {"uuid": "...", "question": "...", "scene_list": [...], "product_list": [...], ...}
  or
  {"uuid": "...", "question": "...", "trap_rubric": "...", ...}
"""

import json
from dataclasses import dataclass
from pathlib import Path

# Category → keyword list (first match wins; order = specificity)
# NOTE: audio must come before phone to avoid "headphone" matching "phone"
_CATEGORY_KEYWORDS: list[tuple[str, list[str]]] = [
    ("camera",      ["camera", "mirrorless", "dslr", "photography", "photographer", "lens", "photo"]),
    ("audio",       ["headphone", "earphone", "earbuds", "tws ", "noise-cancelling", "speaker", "earpiece"]),
    ("phone",       ["smartphone", "mobile phone", "cell phone", " phone ", "new phone", "buy a phone"]),
    ("laptop",      ["laptop", "notebook computer", "macbook", "chromebook"]),
    ("monitor",     ["monitor", " tv ", "television", "display screen", " oled tv", " qled"]),
    ("tablet",      ["tablet", " ipad", "drawing tablet"]),
    ("keyboard",    ["keyboard"]),
    ("mouse",       [" mouse ", " mice ", "gaming mouse", "trackball"]),
    ("gaming",      ["gaming headset", "game controller", "gamepad", "xbox", "playstation", "nintendo"]),
    ("wearables",   ["smartwatch", "smart watch", "fitness tracker", "fitness band", " wearable"]),
    ("printer",     ["printer", "3d printer"]),
    ("beauty",      ["skincare", "skin care", "haircare", "hair care", "makeup", "foundation",
                     "cleanser", "moisturizer", "serum", "mascara", "lipstick", "lip ", "perfume",
                     "fragrance", "shampoo", "conditioner", "hair dryer", "hair serum", "hair mask",
                     "exfoliant", "toner", "face mask", "sunscreen", "blush", "eyebrow"]),
    ("health",      ["wheelchair", "medical", "therapy", "nebulizer", "blood pressure", "glucose",
                     "cpap", "copd", "posture corrector", "massage", "ergonomic chair", "snowboard",
                     "hiking boot", "trekking", "climbing gear"]),
    ("appliances",  ["washing machine", "dishwasher", "range hood", "rice cooker", "water purifier",
                     "water heater", "dehumidifier", "humidifier", "air purifier", "air conditioner",
                     " ac ", "vacuum cleaner", "robot vacuum", "slow juicer", "blender", "microwave",
                     "refrigerator", "fridge", "freezer", "ceiling fan", "electric fan",
                     "drying rack", "sterilizer", "meat grinder", "window cleaning robot",
                     "bed mite remover", "smart door lock", "door lock", "toilet", "bathroom exhaust",
                     "mattress", "baby monitor", "car charger", "electric vehicle"]),
]


def detect_category(question: str) -> str:
    """Detect product category from question text using keyword matching."""
    q = question.lower()
    for category, keywords in _CATEGORY_KEYWORDS:
        if any(kw in q for kw in keywords):
            return category
    return "other"


@dataclass
class ImportResult:
    dataset_id: int
    total: int
    imported: int
    skipped: int
    types: dict[str, int]   # {"shoppingcomp": N, "trap": M}
    categories: dict[str, int]  # {"camera": 14, "phone": 13, ...}


async def import_shoppingcomp(
    jsonl_path: str | Path,
    dataset_name: str,
    description: str = "",
) -> ImportResult:
    """Import a ShoppingComp JSONL file into the eval database.

    Args:
        jsonl_path: Path to the JSONL file
        dataset_name: Name for the dataset in the DB
        description: Optional description

    Returns:
        ImportResult with counts
    """
    from storage.database import init_db
    from storage import queries

    await init_db()

    path = Path(jsonl_path)
    if not path.exists():
        raise FileNotFoundError(f"JSONL file not found: {path}")

    # Create or get dataset
    existing = await queries.get_dataset_by_name(dataset_name)
    if existing:
        dataset_id = existing.id
    else:
        dataset_id = await queries.create_dataset(dataset_name, description)

    imported = 0
    skipped = 0
    types: dict[str, int] = {}
    categories: dict[str, int] = {}

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue

            uuid = entry.get("uuid", "")
            question = entry.get("question", "")

            if not uuid or not question:
                skipped += 1
                continue

            # Determine case type based on fields present
            has_scenes = bool(entry.get("scene_list"))
            has_trap = bool(entry.get("trap_rubric"))

            category = detect_category(question)

            if has_scenes:
                case_type = "shoppingcomp"
                golden_data = {
                    "scene_list": entry.get("scene_list", []),
                    "product_list": entry.get("product_list", []),
                    "category": category,
                }
                if entry.get("source"):
                    golden_data["source"] = entry["source"]
            elif has_trap:
                case_type = "trap"
                golden_data = {
                    "trap_rubric": entry["trap_rubric"],
                    "category": category,
                }
                if entry.get("source"):
                    golden_data["source"] = entry["source"]
            else:
                case_type = "clear_en"
                golden_data = {"category": category}

            # Use first 8 chars of uuid as case key (short + unique)
            case_key = uuid[:8]

            await queries.upsert_case(
                dataset_id=dataset_id,
                key=case_key,
                query=question,
                case_type=case_type,
                constraints={},
                golden_data=golden_data,
            )

            imported += 1
            types[case_type] = types.get(case_type, 0) + 1
            categories[category] = categories.get(category, 0) + 1

    return ImportResult(
        dataset_id=dataset_id,
        total=imported + skipped,
        imported=imported,
        skipped=skipped,
        types=types,
        categories=categories,
    )
