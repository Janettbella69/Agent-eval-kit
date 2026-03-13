"""Trace inspection, annotation, and analysis routes.

GET    /api/traces/{id}        Get full trace data
PATCH  /api/traces/{id}        Partial update (human annotation, status changes)
POST   /api/traces/{id}/annotate  Human annotation for a specific grader
GET    /api/traces/{id}/logs   Grading execution log
GET    /api/cases/history      Case score history (saturation tracking)
POST   /api/traces/{id}/codes  Add/remove open codes (qualitative labels)
GET    /api/traces/coding-analysis  Aggregate open codes across traces
POST   /api/traces/analyze     AI trace analysis (Claude-powered)
GET    /api/traces/analyze/{request_id}  Poll AI analysis result
GET    /api/traces/review-queue  Sample traces for transcript review
POST   /api/traces/{id}/review   Update review status
GET    /api/traces/review-stats  Review coverage statistics
"""

import asyncio
import time
import uuid

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


class AnnotateHumanPassRequest(BaseModel):
    passed: bool


# ── Endpoints ───────────────────────────────────

# ── Fixed paths MUST be before /{trace_id} to avoid path param conflict ──

@router.get("/alignment")
async def get_judge_alignment():
    """Compute TPR/TNR of auto grading vs human PASS/FAIL labels.

    Returns confusion matrix, TPR, TNR, and Rogan-Gladen corrected pass rate.
    Requires human_pass annotations on traces (via POST /{trace_id}/annotate-pass).
    """
    alignment = await queries.compute_judge_alignment()
    return alignment


@router.get("/coding-analysis")
async def get_coding_analysis(experiment_id: int | None = None):
    """Aggregate open codes across traces for qualitative analysis.

    Returns:
        open_codes: [{code, count, pass_rate, example_case_keys}]
        axial_codes: [{theme, codes, count}]  — auto-grouped by prefix
    """
    db = await queries.get_db()

    where = "WHERE status IN ('done', 'graded', 'collected')"
    params: tuple = ()
    if experiment_id:
        where += " AND experiment_id = ?"
        params = (experiment_id,)

    rows = await db.execute_fetchall(
        f"SELECT case_key, final_pass, open_codes FROM traces {where}", params
    )

    # Aggregate open codes
    import json
    code_stats: dict[str, dict] = {}
    for r in rows:
        codes_raw = r["open_codes"] or "[]"
        codes = json.loads(codes_raw) if isinstance(codes_raw, str) else codes_raw
        for code in codes:
            if code not in code_stats:
                code_stats[code] = {"count": 0, "passed": 0, "examples": []}
            code_stats[code]["count"] += 1
            if r["final_pass"]:
                code_stats[code]["passed"] += 1
            if len(code_stats[code]["examples"]) < 5:
                code_stats[code]["examples"].append(r["case_key"])

    open_codes = sorted([
        {
            "code": code,
            "count": stats["count"],
            "pass_rate": round(stats["passed"] / stats["count"], 3) if stats["count"] > 0 else 0,
            "example_case_keys": stats["examples"],
        }
        for code, stats in code_stats.items()
    ], key=lambda x: -x["count"])

    # Auto-group into axial codes by prefix (e.g. "search-" groups)
    axial: dict[str, list[str]] = {}
    for code in code_stats:
        prefix = code.split("-")[0] if "-" in code else code
        axial.setdefault(prefix, []).append(code)

    axial_codes = sorted([
        {
            "theme": theme,
            "codes": codes,
            "count": sum(code_stats[c]["count"] for c in codes),
        }
        for theme, codes in axial.items() if len(codes) >= 1
    ], key=lambda x: -x["count"])

    return {"open_codes": open_codes, "axial_codes": axial_codes, "total_traces": len(rows)}


# ── AI Trace Analysis (Module 11) ──

_analysis_results: dict[str, dict] = {}  # request_id → {status, result, error}


@router.post("/analyze")
async def start_trace_analysis(body: dict):
    """Start AI analysis of one or more traces.

    Body:
        trace_ids: list[int] — traces to analyze
        question: str — analysis question (e.g. "Why did this trace fail?")
    """
    trace_ids = body.get("trace_ids", [])
    question = body.get("question", "")
    if not trace_ids or not question:
        return JSONResponse(status_code=422, content={"detail": "trace_ids and question required."})

    request_id = str(uuid.uuid4())[:8]
    _analysis_results[request_id] = {"status": "running", "result": None, "error": None, "started_at": time.time()}

    # Run analysis in background
    asyncio.create_task(_run_analysis(request_id, trace_ids, question))
    return {"request_id": request_id, "status": "running"}


@router.get("/analyze/{request_id}")
async def get_analysis_result(request_id: str):
    """Poll for AI analysis result."""
    entry = _analysis_results.get(request_id)
    if not entry:
        return JSONResponse(status_code=404, content={"detail": "Analysis request not found."})
    return entry


async def _run_analysis(request_id: str, trace_ids: list[int], question: str):
    """Background task: load traces, build context, call Claude for analysis."""
    try:
        traces = []
        for tid in trace_ids[:5]:  # Cap at 5 traces to limit context
            t = await queries.get_trace(tid)
            if t:
                traces.append(t)

        if not traces:
            _analysis_results[request_id] = {
                "status": "error", "result": None,
                "error": "No valid traces found.", "finished_at": time.time(),
            }
            return

        # Build analysis context
        context_parts = []
        for t in traces:
            summary = (
                f"## Trace #{t.id}: {t.case_key} (trial {t.trial_num})\n"
                f"Query: {t.query}\n"
                f"Score: {t.final_score:.1f} | Pass: {t.final_pass} | Duration: {t.duration_s:.1f}s\n"
                f"Turns: {t.turn_count} | Products: {len(t.products)} | Sources: {len(t.sources)}\n"
            )
            if t.failure_funnel and t.failure_funnel.get("stage"):
                summary += f"Failure Stage: {t.failure_funnel['stage']} — {t.failure_funnel.get('reason', '')}\n"
            if t.error_types:
                summary += f"Error Types: {', '.join(t.error_types)}\n"
            if t.composite_scores:
                scores_str = ", ".join(f"{k}: {v.get('score', 0):.0f}" for k, v in t.composite_scores.items() if isinstance(v, dict))
                summary += f"Grader Scores: {scores_str}\n"
            if t.open_codes:
                summary += f"Open Codes: {', '.join(t.open_codes)}\n"

            # Truncate guide text
            guide_preview = t.guide_text[:2000] + "..." if len(t.guide_text) > 2000 else t.guide_text
            summary += f"\n### Guide Preview:\n{guide_preview}\n"

            # Event summary (tool calls)
            tool_events = [e for e in t.events if isinstance(e, dict) and e.get("type") in ("search_progress", "product_found")]
            if tool_events:
                summary += f"\n### Key Events ({len(tool_events)} tool-related):\n"
                for ev in tool_events[:10]:
                    summary += f"- {ev.get('type')}: {ev.get('query', ev.get('product', {}).get('name', ''))}\n"

            context_parts.append(summary)

        full_context = "\n---\n".join(context_parts)

        # Call Claude for analysis
        try:
            import anthropic
            client = anthropic.AsyncAnthropic()
            response = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2000,
                messages=[{
                    "role": "user",
                    "content": f"""You are an eval analysis assistant for a Shopping Research Agent.
Analyze the following trace(s) and answer the user's question.

{full_context}

Question: {question}

Provide a structured analysis with:
1. Direct answer to the question
2. Key observations from the trace data
3. Suggested improvements or action items

Be concise and specific. Reference trace IDs and scores where relevant."""
                }],
            )
            result_text = response.content[0].text if response.content else "No response generated."
        except Exception as e:
            result_text = f"Claude API unavailable. Manual analysis context:\n\n{full_context[:3000]}\n\n(Error: {str(e)[:200]})"

        _analysis_results[request_id] = {
            "status": "done",
            "result": result_text,
            "error": None,
            "finished_at": time.time(),
            "trace_count": len(traces),
        }
    except Exception as e:
        _analysis_results[request_id] = {
            "status": "error", "result": None,
            "error": str(e)[:500], "finished_at": time.time(),
        }


@router.get("/review-queue")
async def get_review_queue(
    n: int = 10,
    experiment_id: int | None = None,
    strategy: str = "mixed",
):
    """Sample traces for human transcript review.

    Query params:
        n: number of traces to sample (default 10)
        experiment_id: optional filter
        strategy: "mixed" (stratified), "random", or "failures"
    """
    queue = await queries.sample_review_queue(n, experiment_id, strategy)
    return {"traces": queue, "count": len(queue), "strategy": strategy}


@router.get("/review-stats")
async def get_review_stats():
    """Get review coverage statistics."""
    return await queries.get_review_stats()


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


@router.post("/{trace_id}/annotate-pass")
async def annotate_human_pass(trace_id: int, body: AnnotateHumanPassRequest):
    """Set human PASS/FAIL verdict for a trace."""
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})

    await queries.annotate_trace_human_pass(trace_id, body.passed)
    return {"ok": True, "passed": body.passed}


@router.post("/{trace_id}/review")
async def update_review(trace_id: int, body: dict):
    """Update review status for a trace.

    Body:
        status: "reviewed" | "flagged" | "pending"
        notes: str — optional review notes
    """
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})

    status = body.get("status", "reviewed")
    if status not in ("reviewed", "flagged", "pending"):
        return JSONResponse(status_code=422, content={"detail": "status must be reviewed, flagged, or pending."})

    notes = body.get("notes", "")
    await queries.update_review_status(trace_id, status, notes)
    return {"ok": True, "review_status": status}


@router.post("/{trace_id}/codes")
async def update_open_codes(trace_id: int, body: dict):
    """Add or remove open codes (qualitative labels) on a trace.

    Body:
        add: list[str] — codes to add
        remove: list[str] — codes to remove
    """
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})

    codes = list(trace.open_codes)
    for code in body.get("add", []):
        if code and code not in codes:
            codes.append(code)
    for code in body.get("remove", []):
        if code in codes:
            codes.remove(code)

    await queries.update_trace(trace_id, open_codes=codes)
    return {"ok": True, "open_codes": codes}


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
