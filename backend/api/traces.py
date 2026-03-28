"""Trace inspection, annotation, and analysis routes.

GET    /api/traces/{id}        Get full trace data
PATCH  /api/traces/{id}        Partial update (human annotation, status changes)
POST   /api/traces/{id}/annotate  Human annotation for a specific grader
GET    /api/traces/{id}/logs   Grading execution log
GET    /api/cases/history      Case score history (saturation tracking)
POST   /api/traces/{id}/codes  Add/remove open codes (qualitative labels)
GET    /api/traces/coding-analysis  Aggregate open codes across traces
GET    /api/traces/grader-agreement  Per-grader human-LLM agreement stats
POST   /api/traces/analyze     AI trace analysis (Claude-powered)
GET    /api/traces/analyze/{request_id}  Poll AI analysis result
GET    /api/traces/review-queue  Sample traces for transcript review
POST   /api/traces/{id}/review   Update review status
GET    /api/traces/review-stats  Review coverage statistics
POST   /api/traces/{id}/to_case  Convert trace → reusable test case with human verdict
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


class TraceToTestCaseRequest(BaseModel):
    verdict: str = ""           # "pass" or "fail" — human ground truth
    dataset_name: str = ""      # target dataset (default: "human-curated")
    notes: str = ""             # optional reviewer notes


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


@router.get("/grader-agreement")
async def get_grader_agreement():
    """Per-grader agreement between human annotations and LLM scores.

    Returns per-grader stats: count, mean_diff, agreement_rate, pearson_r, bias,
    plus scatter plot data (human vs LLM pairs per grader).
    Requires human score annotations on traces (via POST /{trace_id}/annotate).
    """
    return await queries.compute_grader_agreement()


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


@router.get("/error-taxonomy")
async def get_error_taxonomy():
    """Get the structured error taxonomy for annotation guidance."""
    from graders.error_taxonomy import get_taxonomy_summary
    return {"taxonomy": get_taxonomy_summary()}


# ── AI Trace Analysis (Module 11) ──
# Model: openai/gpt-5.4 via OpenRouter (same as L2 judge)
# Provides deep trace analysis with full grader context + error taxonomy

_analysis_results: dict[str, dict] = {}  # request_id → {status, result, error}
_ANALYSIS_TTL = 3600  # 1 hour TTL for results


def _cleanup_stale_results():
    """Remove analysis results older than TTL."""
    now = time.time()
    stale = [k for k, v in _analysis_results.items()
             if now - v.get("started_at", now) > _ANALYSIS_TTL]
    for k in stale:
        del _analysis_results[k]


# System prompt with eval domain knowledge + error taxonomy
_ANALYSIS_SYSTEM_PROMPT = """You are a senior eval analyst for a Shopping Research Agent.

## Your Role
You analyze evaluation traces to diagnose WHY the agent succeeded or failed.
You have deep knowledge of the agent's architecture and grading pipeline.

## Agent Architecture
The shopping agent: receives a user query → clarifies if ambiguous → searches for products/reviews → synthesizes a buyer's guide with product recommendations.

## Grading Pipeline (what produced the scores you see)
- **L0 Gate**: Binary pass/fail structure checks (has_guide, has_products, has_sources, no_error)
- **Code Graders** (0-100): rubric_coverage, product_matching, source_authority, output_format, efficiency, tool_calls, transcript, state_check, retrieval_quality
- **LLM Graders** (0-100, via GPT-5.4): rubric_compliance, groundedness, actionability, trap_detection
- **Composite**: Weighted average → final_score → PASS if ≥70

## Failure Funnel Stages
The failure funnel identifies the FIRST stage that broke:
1. **understand**: Agent didn't grasp the query (0 searches, very low actionability)
2. **search**: Searched but found nothing useful (0 products AND 0 sources)
3. **extract**: Found sources but failed to extract product data
4. **match_rubric**: Products don't match golden expectations (score <30)
5. **generate**: Has products but output is malformed or too short

## Error Taxonomy (14 categories, 4 stages)
### Retrieval failures
- `retrieval.insufficient_search`: Too few/narrow searches for the query's complexity
- `retrieval.wrong_category`: Searched for wrong product category entirely
- `retrieval.search_loop`: 3+ consecutive searches with no new information
- `retrieval.missed_expert_source`: Missed the obvious expert source (RTINGS for headphones, etc.)

### Extraction failures
- `extraction.stale_price`: Price doesn't match current market (>15% deviation)
- `extraction.discontinued_product`: Product is discontinued/recalled/unavailable
- `extraction.wrong_spec`: Technical spec is incorrect
- `extraction.phantom_citation`: Source cited doesn't support the claim

### Generation failures
- `generation.hallucinated_feature`: Feature that doesn't exist on the product
- `generation.missing_tradeoff`: Recommends without mentioning significant drawbacks
- `generation.promotional_tone`: Marketing copy instead of objective research
- `generation.wrong_audience`: Recommendations don't match user's stated needs/budget

### Format failures
- `format.no_comparison`: No side-by-side comparison table
- `format.no_purchase_path`: No prices, links, or where-to-buy info

## Analysis Guidelines
1. Start with the failure funnel stage — WHERE in the pipeline did things go wrong?
2. Map raw error_types to the taxonomy above — WHAT specifically failed?
3. Check grader scores for patterns — which dimensions are consistently low?
4. Look at the operation log — did the agent's search strategy make sense?
5. Check retrieval_quality diagnosis — is this a retrieval or generation problem?
6. Provide actionable fixes — not just "improve search" but specific changes

## Output Format
Structure your analysis as:
1. **Root Cause**: The primary reason this trace failed/succeeded (1-2 sentences)
2. **Evidence**: Specific data points from grader scores, error types, and events
3. **Taxonomy Classification**: Which error categories apply
4. **Fix Recommendations**: Concrete, actionable suggestions
5. **Severity**: Critical / Major / Minor"""


def _build_trace_context(t) -> str:
    """Build rich analysis context for a single trace."""
    parts = []

    # Header
    parts.append(
        f"## Trace #{t.id}: {t.case_key} (trial {t.trial_num})\n"
        f"**Query**: {t.query}\n"
        f"**Score**: {t.final_score:.1f} | **Pass**: {t.final_pass} | **Duration**: {t.duration_s:.1f}s\n"
        f"**Turns**: {t.turn_count} | **Products**: {len(t.products)} | **Sources**: {len(t.sources)}"
    )

    # Failure funnel
    if t.failure_funnel and t.failure_funnel.get("stage"):
        parts.append(
            f"\n### Failure Funnel\n"
            f"**First failing stage**: {t.failure_funnel['stage']}\n"
            f"**Reason**: {t.failure_funnel.get('reason', 'unknown')}\n"
            f"**All stages**: {', '.join(f'{k}={v}' for k, v in t.failure_funnel.get('stages', {}).items())}"
        )

    # Grader scores with details
    if t.composite_scores:
        parts.append("\n### Grader Scores")
        for name, data in sorted(t.composite_scores.items(), key=lambda x: x[1].get("score", 0) if isinstance(x[1], dict) else 0):
            if not isinstance(data, dict):
                continue
            score = data.get("score", 0)
            weight = data.get("weight", 0)
            category = data.get("category", "?")
            flag = "🔴" if score < 40 else "🟡" if score < 70 else "✅"
            line = f"  {flag} **{name}**: {score:.0f}/100 (weight={weight:.2f}, {category})"
            # Include reasoning for LLM graders
            details = data.get("details", {})
            if isinstance(details, dict):
                reasoning = details.get("reasoning", "")
                if reasoning:
                    line += f"\n    Reasoning: {reasoning[:300]}"
                # Include diagnosis for retrieval_quality
                diagnosis = details.get("diagnosis", "")
                if diagnosis:
                    line += f"\n    Diagnosis: {diagnosis}"
            parts.append(line)

    # Error types + taxonomy classification
    if t.error_types:
        parts.append(f"\n### Raw Error Types\n{', '.join(t.error_types)}")
        try:
            from graders.error_taxonomy import classify_error_types
            classified = classify_error_types(t.error_types)
            if classified:
                parts.append("\n### Classified Errors (from taxonomy)")
                for c in classified:
                    parts.append(f"  - **{c['severity'].upper()}** [{c['stage']}] {c['code']}: {c['name']}")
        except Exception:
            pass

    if t.open_codes:
        parts.append(f"\n### Open Codes: {', '.join(t.open_codes)}")

    # Products summary
    if t.products:
        parts.append(f"\n### Products ({len(t.products)})")
        for i, p in enumerate(t.products[:8], 1):
            if isinstance(p, dict):
                name = p.get("name", "?")
                price = p.get("price", "N/A")
                url = p.get("purchaseUrl", "")
                parts.append(f"  {i}. {name} — {price}" + (f" [{url[:50]}]" if url else ""))

    # Sources summary
    if t.sources:
        parts.append(f"\n### Sources ({len(t.sources)})")
        for i, s in enumerate(t.sources[:10], 1):
            if isinstance(s, dict):
                title = s.get("title", "?")
                domain = s.get("domain", "")
                parts.append(f"  {i}. {title} ({domain})")

    # Guide text (expanded: 5000 chars for single trace, 3000 for multi)
    guide_limit = 5000 if len(t.guide_text) > 0 else 0
    if t.guide_text:
        preview = t.guide_text[:guide_limit]
        if len(t.guide_text) > guide_limit:
            preview += f"\n... [truncated, {len(t.guide_text)} total chars]"
        parts.append(f"\n### Guide Text\n{preview}")

    # Operation log: search queries + fetch URLs + errors
    events = t.events or []
    search_queries = []
    fetch_urls = []
    errors = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        etype = ev.get("type", "")
        if etype == "search_progress":
            q = ev.get("query", ev.get("phase", ""))
            if q and q not in search_queries:
                search_queries.append(q)
        elif etype == "error":
            errors.append(ev.get("message", "?")[:150])

    if search_queries:
        parts.append(f"\n### Search Queries ({len(search_queries)})")
        for i, q in enumerate(search_queries[:20], 1):
            parts.append(f"  {i}. {q}")

    if errors:
        parts.append(f"\n### Errors ({len(errors)})")
        for err in errors[:5]:
            parts.append(f"  ⚠ {err}")

    # Grading log summary
    if t.grading_log:
        parts.append(f"\n### Grading Pipeline Log")
        for entry in t.grading_log:
            if not isinstance(entry, dict):
                continue
            step = entry.get("step", "?")
            status = entry.get("status", "?")
            score = entry.get("score")
            duration = entry.get("duration_s", 0)
            if score is not None:
                parts.append(f"  {step}: {score:.0f} ({status}, {duration:.1f}s)")

    return "\n".join(parts)


@router.post("/analyze")
async def start_trace_analysis(body: dict):
    """Start AI analysis of one or more traces.

    Body:
        trace_ids: list[int] — traces to analyze
        question: str — analysis question (e.g. "Why did this trace fail?")
    """
    _cleanup_stale_results()

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
    """Background task: load traces, build rich context, call GPT-5.4 (OpenAI direct) or fallback."""
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

        # Build rich context for each trace
        # Adjust guide text limit based on number of traces
        context_parts = []
        for t in traces:
            context_parts.append(_build_trace_context(t))

        full_context = "\n\n---\n\n".join(context_parts)

        # Call LLM for analysis — prefer OpenAI direct (avoids OpenRouter bans)
        try:
            import os
            openai_key = os.getenv("OPENAI_API_KEY", "")

            if openai_key:
                # Path 1: OpenAI direct (preferred — strongest available model)
                from openai import AsyncOpenAI
                client = AsyncOpenAI(api_key=openai_key)
                model = os.getenv("ANALYSIS_MODEL", "gpt-5.4")
                response = await client.chat.completions.create(
                    model=model,
                    max_completion_tokens=4000,
                    temperature=0.2,
                    messages=[
                        {"role": "system", "content": _ANALYSIS_SYSTEM_PROMPT},
                        {"role": "user", "content": f"""Analyze the following trace(s) and answer my question.

{full_context}

---

**Question**: {question}

Provide a structured analysis following the output format in your system prompt.
Reference specific trace IDs, grader scores, and error taxonomy codes."""},
                    ],
                )
                result_text = response.choices[0].message.content or "No response generated."
                model_used = model
            else:
                # Path 2: Anthropic SDK (via OpenRouter or direct)
                import anthropic
                base_url = os.getenv("ANTHROPIC_BASE_URL", "")
                auth_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
                api_key = os.getenv("ANTHROPIC_API_KEY", "")

                if base_url and auth_token:
                    client = anthropic.AsyncAnthropic(base_url=base_url, api_key=auth_token)
                    model = os.getenv("GRADING_MODEL", "minimax/minimax-m2.7")
                elif api_key:
                    client = anthropic.AsyncAnthropic(api_key=api_key)
                    model = "claude-sonnet-4-6"
                else:
                    raise RuntimeError("No API key configured (OPENAI_API_KEY, ANTHROPIC_AUTH_TOKEN, or ANTHROPIC_API_KEY)")

                response = await client.messages.create(
                    model=model,
                    max_tokens=4000,
                    system=_ANALYSIS_SYSTEM_PROMPT,
                    messages=[{
                        "role": "user",
                        "content": f"""Analyze the following trace(s) and answer my question.

{full_context}

---

**Question**: {question}

Provide a structured analysis following the output format in your system prompt.
Reference specific trace IDs, grader scores, and error taxonomy codes."""
                    }],
                )
                result_text = response.content[0].text if response.content else "No response generated."
                model_used = model
        except Exception as e:
            result_text = f"AI analysis unavailable. Manual analysis context:\n\n{full_context[:5000]}\n\n(Error: {str(e)[:200]})"
            model_used = "fallback"

        _analysis_results[request_id] = {
            "status": "done",
            "result": result_text,
            "error": None,
            "finished_at": time.time(),
            "trace_count": len(traces),
            "model": model_used,
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


@router.get("/{trace_id}/classified-errors")
async def get_classified_errors(trace_id: int):
    """Get errors classified against the structured taxonomy."""
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})

    from graders.error_taxonomy import classify_error_types, prioritize_errors
    classified = classify_error_types(trace.error_types)
    prioritized = prioritize_errors(classified)
    return {
        "trace_id": trace_id,
        "raw_error_types": trace.error_types,
        "classified": prioritized,
        "total_raw": len(trace.error_types),
        "total_classified": len(prioritized),
    }


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


# ── Trace → Test Case ────────────────────────────

CURATED_DATASET_NAME = "human-curated"

@router.post("/{trace_id}/to_case")
async def trace_to_test_case(trace_id: int, body: TraceToTestCaseRequest):
    """Convert a production trace into a reusable test case with human ground truth.

    Creates/reuses a "human-curated" dataset (or custom name), inserts the trace's
    query as a case, and stores the trace's output as reference_output + golden_data.
    If verdict is provided, also annotates human_pass on the trace.

    This is the key bridge between observability and evaluation:
    production trace → curated test case → judge validation.
    """
    trace = await queries.get_trace(trace_id)
    if not trace:
        return JSONResponse(status_code=404, content={"detail": "Trace not found."})

    if not trace.query:
        return JSONResponse(status_code=422, content={"detail": "Trace has no query."})

    # Get or create target dataset
    ds_name = body.dataset_name.strip() or CURATED_DATASET_NAME
    dataset = await queries.get_dataset_by_name(ds_name)
    if dataset:
        dataset_id = dataset.id
    else:
        dataset_id = await queries.create_dataset(
            name=ds_name,
            description="Human-curated test cases from production traces",
            suite_type="capability",
        )

    # Build golden_data from trace output (products, sources as reference)
    import json
    products = trace.products if isinstance(trace.products, list) else []
    sources = trace.sources if isinstance(trace.sources, list) else []

    golden_data = {}
    if products:
        golden_data["product_list"] = [
            {"product_name": p.get("name", "") if isinstance(p, dict) else str(p)}
            for p in products[:10]
        ]

    # Build reference_output (full agent output for comparison)
    reference_output = {
        "guide_text": trace.guide_text[:15000] if trace.guide_text else "",
        "product_count": len(products),
        "source_count": len(sources),
        "duration_s": trace.duration_s,
    }

    # Case key: use trace's case_key or generate from query
    import hashlib
    case_key = trace.case_key or f"curated-{hashlib.md5(trace.query.encode()).hexdigest()[:8]}"

    # Upsert case
    case_id = await queries.upsert_case(
        dataset_id=dataset_id,
        key=case_key,
        query=trace.query,
        case_type=trace.case_type or "production",
        constraints={},
        golden_data=golden_data,
        reference_output=reference_output,
    )

    # If verdict provided, annotate human_pass on the trace
    verdict_recorded = False
    if body.verdict.lower() in ("pass", "fail"):
        human_pass = body.verdict.lower() == "pass"
        await queries.update_trace(trace_id, human_pass=human_pass)
        verdict_recorded = True

    # Store notes as open code if provided
    if body.notes:
        existing_codes = list(trace.open_codes) if trace.open_codes else []
        note_code = f"curator_note:{body.notes[:200]}"
        if note_code not in existing_codes:
            existing_codes.append(note_code)
            await queries.update_trace(trace_id, open_codes=existing_codes)

    await queries.bump_dataset_version(dataset_id)

    return {
        "ok": True,
        "dataset_id": dataset_id,
        "dataset_name": ds_name,
        "case_id": case_id,
        "case_key": case_key,
        "verdict_recorded": verdict_recorded,
        "trace_id": trace_id,
    }
