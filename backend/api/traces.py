"""Trace inspection and annotation routes."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from storage import queries

router = APIRouter(prefix="/api/traces", tags=["traces"])


@router.get("/{trace_id}")
async def get_trace(trace_id: int):
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})
    return trace.model_dump()


@router.patch("/{trace_id}")
async def annotate_trace(trace_id: int, body: dict):
    """Update trace with human annotations (partial update).

    Allowed fields: l2_scores, final_score, final_pass, status.
    """
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})

    allowed = {"l2_scores", "final_score", "final_pass", "status"}
    updates = {k: v for k, v in body.items() if k in allowed}

    if not updates:
        return JSONResponse(status_code=422, content={"detail": "No valid fields to update."})

    await queries.update_trace(trace_id, **updates)
    return {"ok": True, "updated": list(updates.keys())}
