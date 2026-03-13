"""Production trace import: LangFuse → Eval pipeline.

Fetches real user traces from LangFuse, converts them to eval format,
creates a production experiment, and optionally runs grading.

POST /api/production/import  — import traces from LangFuse
GET  /api/production/status  — check LangFuse connectivity
"""

import asyncio
import time
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from config import LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL
from storage import queries
from runner.executor import regrade_experiment

router = APIRouter(prefix="/api/production", tags=["production"])


def _get_langfuse_client():
    """Create a fresh LangFuse client for the eval platform.

    Separate from the product backend's client — reads from eval config.
    """
    if not LANGFUSE_SECRET_KEY or not LANGFUSE_PUBLIC_KEY:
        return None
    try:
        from langfuse import Langfuse
        return Langfuse(
            secret_key=LANGFUSE_SECRET_KEY,
            public_key=LANGFUSE_PUBLIC_KEY,
            host=LANGFUSE_BASE_URL,
        )
    except Exception:
        return None


# ── Models ──────────────────────────────────────

class ImportRequest(BaseModel):
    limit: int = 20          # max traces to import
    days: int = 7            # look back N days
    tag: str = "shopping-research"  # LangFuse tag filter
    run_grading: bool = True  # auto-grade after import
    experiment_tag: str = ""  # custom tag (auto-generated if empty)


# ── Endpoints ───────────────────────────────────

@router.get("/status")
async def langfuse_status():
    """Check LangFuse connectivity and return basic stats."""
    client = _get_langfuse_client()
    if not client:
        return {"connected": False, "reason": "No LangFuse API keys configured"}

    try:
        # Fetch 1 trace to verify connectivity
        result = client.fetch_traces(limit=1)
        return {
            "connected": True,
            "host": LANGFUSE_BASE_URL,
            "trace_count": len(result.data),
        }
    except Exception as e:
        return {"connected": False, "reason": str(e)[:200]}


@router.post("/import")
async def import_production_traces(body: ImportRequest):
    """Import production traces from LangFuse into eval system.

    1. Fetches traces from LangFuse (filtered by tag + date range)
    2. Creates a "production" dataset with auto-generated cases
    3. Creates an experiment linked to the dataset
    4. Inserts traces as pre-collected data
    5. Optionally runs grading pipeline (code graders only — no golden_data)

    Returns:
        experiment_id, dataset_id, traces_imported, traces_skipped
    """
    client = _get_langfuse_client()
    if not client:
        return JSONResponse(
            status_code=503,
            content={"detail": "LangFuse not configured. Set LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY."},
        )

    # Fetch traces from LangFuse
    from_ts = datetime.now(timezone.utc) - timedelta(days=body.days)
    try:
        lf_traces = client.fetch_traces(
            limit=body.limit,
            tags=[body.tag] if body.tag else None,
            from_timestamp=from_ts,
        )
    except Exception as e:
        return JSONResponse(
            status_code=502,
            content={"detail": f"LangFuse fetch failed: {str(e)[:300]}"},
        )

    if not lf_traces.data:
        return {"experiment_id": None, "traces_imported": 0, "traces_skipped": 0,
                "detail": "No traces found matching criteria."}

    # Create dataset for production traces
    date_str = datetime.now().strftime("%Y-%m-%d")
    dataset_name = f"production-{date_str}"

    # Check if dataset already exists, create new with suffix if needed
    existing = await queries.get_dataset_by_name(dataset_name)
    if existing:
        dataset_name = f"production-{date_str}-{int(time.time()) % 10000}"

    dataset_id = await queries.create_dataset(
        name=dataset_name,
        description=f"Production traces imported from LangFuse ({body.days}d, tag={body.tag})",
        suite_type="capability",
    )

    # Create experiment
    exp_tag = body.experiment_tag or f"prod-import-{date_str}"
    config = {
        "cases": None,
        "trials": 1,
        "concurrency": 1,
        "judge_enabled": False,
        "source": "langfuse",
        "langfuse_tag": body.tag,
        "days": body.days,
        "mode": "production",
    }
    experiment_id = await queries.create_experiment(dataset_id, exp_tag, config)
    await queries.update_experiment_status(experiment_id, "importing")

    # Process each LangFuse trace
    imported = 0
    skipped = 0

    for lf_trace in lf_traces.data:
        try:
            trace_data = _convert_langfuse_trace(lf_trace)
            if not trace_data:
                skipped += 1
                continue

            # Upsert case (query as key)
            case_key = trace_data["case_key"]
            await queries.upsert_case(
                dataset_id=dataset_id,
                key=case_key,
                query=trace_data["query"],
                case_type="production",
                constraints={},
                golden_data={},  # No golden data for production traces
            )

            # Create trace in eval DB
            trace_id = await queries.create_trace(
                experiment_id=experiment_id,
                case_key=case_key,
                trial_num=1,
                query=trace_data["query"],
                case_type="production",
            )

            # Update with collected data
            await queries.update_trace(trace_id, **{
                "status": "collected",
                "duration_s": trace_data["duration_s"],
                "guide_text": trace_data["guide_text"],
                "products": trace_data["products"],
                "sources": trace_data["sources"],
                "events": [],  # No raw SSE events from LangFuse
                "hook_metrics": trace_data["hook_metrics"],
                "error_events": [],
                "clarification": None,
                "prompt_version": "",
                "model": trace_data.get("model", ""),
                "input_tokens": trace_data.get("input_tokens", 0),
                "output_tokens": trace_data.get("output_tokens", 0),
                "turn_count": trace_data.get("turn_count", 0),
                "system_prompt": "",
                "tool_names": trace_data.get("tool_names", []),
            })
            imported += 1

        except Exception:
            skipped += 1
            continue

    # Run grading if requested
    if body.run_grading and imported > 0:
        await queries.update_experiment_status(experiment_id, "grading")
        asyncio.create_task(_grade_production_experiment(experiment_id))
    elif imported > 0:
        # Mark complete without grading
        summary = await queries.compute_experiment_summary(experiment_id)
        await queries.update_experiment_status(
            experiment_id, "complete",
            summary=summary.model_dump(),
            finished_at=time.time(),
        )

    return {
        "experiment_id": experiment_id,
        "dataset_id": dataset_id,
        "traces_imported": imported,
        "traces_skipped": skipped,
    }


# ── Helpers ──────────────────────────────────────

def _convert_langfuse_trace(lf_trace) -> dict | None:
    """Convert a LangFuse trace to eval trace data.

    LangFuse trace output format (set by backend/api/routes.py):
        {guide, eval_context, products, sources, product_count, source_count, elapsed_s}

    LangFuse trace metadata:
        {search_count, entity_count, entities, dimensions_explored,
         dimension_coverage, source_domain_count, source_domains,
         failure_count, budget, category, requirements_total, requirements_covered}
    """
    output = lf_trace.output or {}
    metadata = lf_trace.metadata or {}
    input_data = lf_trace.input or {}

    # Extract query from input
    query = ""
    if isinstance(input_data, dict):
        query = input_data.get("query", input_data.get("message", ""))
    elif isinstance(input_data, str):
        query = input_data

    if not query:
        return None  # Skip traces without a query

    guide_text = output.get("guide", "")
    if not guide_text:
        return None  # Skip traces without output

    # Build case_key from query (sanitized, truncated)
    case_key = _make_case_key(query)

    # Reconstruct hook_metrics from LangFuse metadata
    hook_metrics = {
        "search_count": metadata.get("search_count", 0),
        "entity_count": metadata.get("entity_count", 0),
        "entities": metadata.get("entities", []),
        "dimensions_explored": metadata.get("dimensions_explored", 0),
        "dimension_coverage": metadata.get("dimension_coverage", {}),
        "source_domain_count": metadata.get("source_domain_count", 0),
        "source_domains": metadata.get("source_domains", []),
        "failure_count": metadata.get("failure_count", 0),
        "budget": metadata.get("budget", ""),
        "category": metadata.get("category", ""),
        "requirements_total": metadata.get("requirements_total", 0),
        "requirements_covered": metadata.get("requirements_covered", 0),
    }

    # Extract token usage if available
    usage = getattr(lf_trace, "usage", None) or {}
    input_tokens = 0
    output_tokens = 0
    if isinstance(usage, dict):
        input_tokens = usage.get("input", usage.get("promptTokens", 0)) or 0
        output_tokens = usage.get("output", usage.get("completionTokens", 0)) or 0

    # Extract model name
    model = getattr(lf_trace, "model", "") or ""

    return {
        "case_key": case_key,
        "query": query,
        "duration_s": output.get("elapsed_s", 0) or 0,
        "guide_text": guide_text,
        "products": output.get("products", []),
        "sources": output.get("sources", []),
        "hook_metrics": hook_metrics,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "turn_count": 0,  # Not tracked in LangFuse output
        "tool_names": [],  # Not tracked in LangFuse output
    }


def _make_case_key(query: str) -> str:
    """Generate a case key from a query string.

    Lowercase, replace spaces with hyphens, truncate to 80 chars.
    """
    import re
    key = query.lower().strip()
    key = re.sub(r"[^a-z0-9\u4e00-\u9fff\s-]", "", key)  # Keep alphanumeric + CJK + hyphens
    key = re.sub(r"\s+", "-", key)
    return key[:80]


async def _grade_production_experiment(experiment_id: int):
    """Grade production traces (background task).

    Production traces have no golden_data, so only code graders will produce
    meaningful scores. LLM graders that require golden_data will score 0
    (or be skipped by the pipeline).
    """
    try:
        count = await regrade_experiment(experiment_id)
        # regrade_experiment already updates summary and status
    except Exception:
        # Mark as complete even on grading failure
        summary = await queries.compute_experiment_summary(experiment_id)
        await queries.update_experiment_status(
            experiment_id, "complete",
            summary=summary.model_dump(),
            finished_at=time.time(),
        )
