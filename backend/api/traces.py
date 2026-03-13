"""Trace inspection, annotation, and analysis routes.

GET    /api/traces/{id}        Get full trace data
PATCH  /api/traces/{id}        Partial update (human annotation, status changes)
POST   /api/traces/{id}/annotate  Human annotation for a specific grader
GET    /api/traces/{id}/logs   Grading execution log
GET    /api/cases/history      Case score history (saturation tracking)
"""

from pydantic import BaseModel

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from storage import queries

router = APIRouter(prefix="/api/traces", tags=["traces"])


# ── Models ──────────────────────────────────────

class AnnotateGraderRequest(BaseModel):
    grader_name: str
    human_score: float
    human_reasoning: str = ""


# ── Endpoints ───────────────────────────────────

@router.get("/{trace_id}")
async def get_trace(trace_id: int):
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})
    return trace.model_dump()


@router.patch("/{trace_id}")
async def annotate_trace(trace_id: int, body: dict):
    """Update trace with human annotations (partial update).

    Allowed fields: l2_scores, final_score, final_pass, status, human_scores.
    """
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})

    allowed = {"l2_scores", "final_score", "final_pass", "status", "human_scores"}
    updates = {k: v for k, v in body.items() if k in allowed}

    if not updates:
        return JSONResponse(status_code=422, content={"detail": "No valid fields to update."})

    await queries.update_trace(trace_id, **updates)
    return {"ok": True, "updated": list(updates.keys())}


@router.post("/{trace_id}/annotate")
async def annotate_grader(trace_id: int, body: AnnotateGraderRequest):
    """Add or update a human score for a specific grader on this trace.

    Used for LLM-judge calibration: human experts score the same dimensions
    as LLM graders, then we compare for agreement.
    """
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})

    await queries.annotate_trace(
        trace_id, body.grader_name, body.human_score, body.human_reasoning,
    )

    # Compute agreement with LLM score if available
    llm_data = trace.composite_scores.get(body.grader_name)
    agreement = None
    if llm_data and isinstance(llm_data, dict):
        llm_score = llm_data.get("score", 0)
        diff = abs(llm_score - body.human_score)
        agreement = {
            "llm_score": llm_score,
            "human_score": body.human_score,
            "diff": round(diff, 1),
            "aligned": diff <= 15,  # Within 15 points = aligned
        }

    return {"ok": True, "agreement": agreement}


@router.get("/{trace_id}/logs")
async def get_trace_logs(trace_id: int):
    """Get the grading execution log for a trace.

    Returns per-grader timing, scores, errors, and LLM reasoning previews.
    """
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})

    return {
        "trace_id": trace_id,
        "grading_log": trace.grading_log,
        "grading_duration_s": trace.grading_duration_s,
        "human_scores": trace.human_scores,
    }
