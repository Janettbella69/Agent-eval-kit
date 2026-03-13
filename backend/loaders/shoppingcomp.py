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


@dataclass
class ImportResult:
    dataset_id: int
    total: int
    imported: int
    skipped: int
    types: dict[str, int]  # {"shoppingcomp": N, "trap": M}


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

    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
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

            if has_scenes:
                case_type = "shoppingcomp"
                golden_data = {
                    "scene_list": entry.get("scene_list", []),
                    "product_list": entry.get("product_list", []),
                }
                # Include source metadata if available
                if entry.get("source"):
                    golden_data["source"] = entry["source"]
            elif has_trap:
                case_type = "trap"
                golden_data = {
                    "trap_rubric": entry["trap_rubric"],
                }
                if entry.get("source"):
                    golden_data["source"] = entry["source"]
            else:
                # Unknown format — import as generic
                case_type = "clear_en"
                golden_data = {}

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

    total = imported + skipped
    return ImportResult(
        dataset_id=dataset_id,
        total=total,
        imported=imported,
        skipped=skipped,
        types=types,
    )
