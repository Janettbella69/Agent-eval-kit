"""Dataset management routes."""

import json
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from storage import queries
from storage.models import DatasetIn

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

DATASETS_DIR = Path(__file__).parent.parent.parent / "datasets"


@router.get("")
async def list_datasets():
    datasets = await queries.list_datasets()
    return [d.model_dump() for d in datasets]


@router.get("/{dataset_id}")
async def get_dataset(dataset_id: int):
    dataset = await queries.get_dataset(dataset_id)
    if not dataset:
        return JSONResponse(status_code=404, content={"detail": "Dataset not found."})
    cases = await queries.get_cases(dataset_id)
    return {
        **dataset.model_dump(),
        "cases": [c.model_dump() for c in cases],
    }


@router.post("/import")
async def import_dataset(body: DatasetIn | None = None, name: str | None = None):
    """Import a dataset from JSON file or request body.

    If `name` is provided (query param), loads from eval/datasets/{name}.json.
    If body is provided, uses inline cases.
    """
    if name:
        # Load from file
        file_path = DATASETS_DIR / f"{name}.json"
        if not file_path.exists():
            return JSONResponse(status_code=404, content={"detail": f"Dataset file not found: {name}.json"})
        data = json.loads(file_path.read_text())
        dataset_name = data.get("name", name)
        description = data.get("description", "")
        cases = data.get("cases", [])
    elif body:
        dataset_name = body.name
        description = body.description
        cases = [c.model_dump() for c in body.cases]
    else:
        return JSONResponse(status_code=422, content={"detail": "Provide name (query param) or body."})

    suite_type = "capability"
    if body and hasattr(body, "suite_type"):
        suite_type = body.suite_type
    elif name:
        suite_type = data.get("suite_type", "capability")

    # Upsert dataset
    existing = await queries.get_dataset_by_name(dataset_name)
    if existing:
        dataset_id = existing.id
        await queries.update_dataset(dataset_id, suite_type=suite_type)
    else:
        dataset_id = await queries.create_dataset(dataset_name, description, suite_type)

    # Upsert cases
    count = 0
    for case in cases:
        await queries.upsert_case(
            dataset_id,
            case["key"],
            case["query"],
            case.get("type", "clear_en"),
            case.get("constraints", {}),
            case.get("golden_data", {}),
            case.get("reference_output"),
        )
        count += 1

    return {"dataset_id": dataset_id, "name": dataset_name, "cases_imported": count}


@router.patch("/{dataset_id}")
async def update_dataset(dataset_id: int, body: dict):
    """Update dataset metadata (suite_type, description)."""
    dataset = await queries.get_dataset(dataset_id)
    if not dataset:
        return JSONResponse(status_code=404, content={"detail": "Dataset not found."})

    allowed = {"suite_type", "description"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        return JSONResponse(status_code=422, content={"detail": "No valid fields."})

    await queries.update_dataset(dataset_id, **updates)
    return {"ok": True, "updated": list(updates.keys())}


@router.get("/{dataset_id}/saturation")
async def get_saturation(dataset_id: int):
    """Per-case saturation summary — identifies saturated (100% pass) cases."""
    cases = await queries.get_saturation_summary(dataset_id)
    saturated = sum(1 for c in cases if c["saturated"])
    return {
        "dataset_id": dataset_id,
        "total_cases": len(cases),
        "saturated_cases": saturated,
        "cases": cases,
    }


@router.get("/cases/history")
async def get_case_history_endpoint(case_key: str, dataset_id: int | None = None):
    """Score history for a case across experiments (saturation tracking)."""
    history = await queries.get_case_history(case_key, dataset_id)
    return {"case_key": case_key, "history": history}


@router.post("/import-shoppingcomp")
async def import_shoppingcomp_endpoint(file_path: str, name: str, description: str = ""):
    """Import a ShoppingComp JSONL file via API."""
    from loaders.shoppingcomp import import_shoppingcomp

    path = Path(file_path)
    if not path.is_absolute():
        path = DATASETS_DIR.parent.parent / path

    if not path.exists():
        return JSONResponse(status_code=404, content={"detail": f"File not found: {path}"})

    result = await import_shoppingcomp(path, name, description)
    return {
        "dataset_id": result.dataset_id,
        "imported": result.imported,
        "skipped": result.skipped,
        "types": result.types,
    }
