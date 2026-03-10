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

    # Upsert dataset
    existing = await queries.get_dataset_by_name(dataset_name)
    if existing:
        dataset_id = existing.id
    else:
        dataset_id = await queries.create_dataset(dataset_name, description)

    # Upsert cases
    count = 0
    for case in cases:
        await queries.upsert_case(
            dataset_id,
            case["key"],
            case["query"],
            case.get("type", "clear_en"),
            case.get("constraints", {}),
        )
        count += 1

    return {"dataset_id": dataset_id, "name": dataset_name, "cases_imported": count}
