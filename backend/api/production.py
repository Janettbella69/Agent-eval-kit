"""Production trace import: LangFuse → Eval pipeline.

Fetches real user traces from LangFuse, converts them to eval format,
creates a production experiment, and optionally runs grading.

POST /api/production/import   — import traces from LangFuse
GET  /api/production/status   — check LangFuse connectivity + stats
GET  /api/production/preview  — preview traces before importing
"""

import asyncio
import logging
import re
import time
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

from pydantic import BaseModel
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from config import LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL
from storage import queries
from runner.executor import regrade_experiment

router = APIRouter(prefix="/api/production", tags=["production"])


# ── LangFuse client ─────────────────────────────

def _get_langfuse_client():
    """Create a LangFuse client for the eval platform."""
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
    limit: int = 20           # max traces to import
    days: int = 7             # look back N days
    tag: str = "shopping-research"  # LangFuse tag filter
    run_grading: bool = True  # auto-grade after import
    experiment_tag: str = ""  # custom tag (auto-generated if empty)
    min_duration_s: float = 5 # skip traces shorter than this (likely errors)
    require_output: bool = True  # skip traces without guide output


# ── Endpoints ───────────────────────────────────

@router.get("/status")
async def langfuse_status():
    """Check LangFuse connectivity and return trace stats."""
    client = _get_langfuse_client()
    if not client:
        return {"connected": False, "reason": "No LangFuse API keys configured"}

    try:
        # Fetch recent traces to verify connectivity
        result = client.api.trace.list(limit=5, tags="shopping-research")
        trace_count = result.meta.total_items if result.meta else len(result.data)

        # Date range of available traces
        dates = []
        for t in result.data:
            if hasattr(t, "timestamp") and t.timestamp:
                dates.append(t.timestamp.isoformat() if hasattr(t.timestamp, "isoformat") else str(t.timestamp))

        # Check for already-imported traces
        db = await queries.get_db()
        imported = await db.execute_fetchall(
            "SELECT COUNT(*) as c FROM traces WHERE model LIKE '%langfuse%' OR case_type = 'production'"
        )
        already_imported = imported[0]["c"] if imported else 0

        return {
            "connected": True,
            "host": LANGFUSE_BASE_URL,
            "total_shopping_traces": trace_count,
            "date_range": dates[:2] if dates else [],
            "already_imported": already_imported,
        }
    except Exception as e:
        return {"connected": False, "reason": str(e)[:300]}


@router.get("/preview")
async def preview_traces(
    limit: int = 10,
    days: int = 7,
    tag: str = "shopping-research",
):
    """Preview LangFuse traces before importing.

    Returns trace summaries without creating anything in the eval DB.
    """
    client = _get_langfuse_client()
    if not client:
        return JSONResponse(status_code=503, content={"detail": "LangFuse not configured."})

    from_ts = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        lf_traces = client.api.trace.list(
            limit=limit,
            tags=tag if tag else None,
            from_timestamp=from_ts,
        )
    except Exception as e:
        return JSONResponse(status_code=502, content={"detail": f"LangFuse fetch failed: {str(e)[:300]}"})

    previews = []
    for t in lf_traces.data:
        output = t.output or {}
        input_data = t.input or {}
        metadata = t.metadata or {}

        query = _extract_query(input_data)
        guide_text = output.get("guide", "") if isinstance(output, dict) else ""

        previews.append({
            "langfuse_id": t.id,
            "query": query[:120] if query else "(no query)",
            "has_output": bool(guide_text),
            "guide_length": len(guide_text),
            "product_count": output.get("product_count", len(output.get("products", []))) if isinstance(output, dict) else 0,
            "source_count": output.get("source_count", len(output.get("sources", []))) if isinstance(output, dict) else 0,
            "duration_s": output.get("elapsed_s", 0) if isinstance(output, dict) else 0,
            "model": metadata.get("model", ""),
            "timestamp": t.timestamp.isoformat() if hasattr(t, "timestamp") and t.timestamp else "",
            "tags": getattr(t, "tags", []) or [],
        })

    return {
        "traces": previews,
        "total": len(previews),
        "importable": sum(1 for p in previews if p["has_output"] and p["query"] != "(no query)"),
    }


@router.post("/import")
async def import_production_traces(body: ImportRequest):
    """Import production traces from LangFuse into eval system.

    1. Fetches traces from LangFuse (filtered by tag + date range)
    2. Deduplicates against already-imported langfuse_trace_ids
    3. Creates a "production" dataset with auto-generated cases
    4. Creates an experiment linked to the dataset
    5. Inserts traces as pre-collected data
    6. Optionally runs grading pipeline (code graders + LLM graders without golden_data)

    Returns experiment_id, dataset_id, traces_imported, traces_skipped
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
        lf_traces = client.api.trace.list(
            limit=body.limit,
            tags=body.tag if body.tag else None,
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

    # Check already-imported langfuse IDs to avoid duplicates
    existing_lf_ids = await _get_imported_langfuse_ids()

    # Create dataset for production traces
    date_str = datetime.now().strftime("%Y-%m-%d")
    dataset_name = f"production-{date_str}"
    existing = await queries.get_dataset_by_name(dataset_name)
    if existing:
        dataset_name = f"production-{date_str}-{int(time.time()) % 10000}"

    dataset_id = await queries.create_dataset(
        name=dataset_name,
        description=f"Production traces from LangFuse ({body.days}d, tag={body.tag})",
        suite_type="capability",
    )

    # Create experiment
    exp_tag = body.experiment_tag or f"prod-import-{date_str}"
    config = {
        "cases": None,
        "trials": 1,
        "concurrency": 1,
        "judge_enabled": body.run_grading,
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
    skip_reasons: dict[str, int] = {}

    for lf_trace in lf_traces.data:
        # Dedup check
        if lf_trace.id in existing_lf_ids:
            skip_reasons["already_imported"] = skip_reasons.get("already_imported", 0) + 1
            skipped += 1
            continue

        try:
            trace_data = _convert_langfuse_trace(lf_trace)
            if not trace_data:
                skip_reasons["no_query_or_output"] = skip_reasons.get("no_query_or_output", 0) + 1
                skipped += 1
                continue

            # Apply filters
            if body.require_output and not trace_data["guide_text"]:
                skip_reasons["no_output"] = skip_reasons.get("no_output", 0) + 1
                skipped += 1
                continue

            if trace_data["duration_s"] < body.min_duration_s:
                skip_reasons["too_short"] = skip_reasons.get("too_short", 0) + 1
                skipped += 1
                continue

            # Upsert case
            case_key = trace_data["case_key"]
            await queries.upsert_case(
                dataset_id=dataset_id,
                key=case_key,
                query=trace_data["query"],
                case_type="production",
                constraints={},
                golden_data={},  # No golden data for production traces
            )

            # Create trace
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
                "events": trace_data["events"],
                "hook_metrics": trace_data["hook_metrics"],
                "error_events": trace_data.get("error_events", []),
                "clarification": None,
                "prompt_version": trace_data.get("prompt_version", ""),
                "model": f"langfuse:{lf_trace.id}",  # Tag with langfuse ID for dedup
                "input_tokens": trace_data.get("input_tokens", 0),
                "output_tokens": trace_data.get("output_tokens", 0),
                "turn_count": trace_data.get("turn_count", 0),
                "system_prompt": "",
                "tool_names": trace_data.get("tool_names", []),
            })
            imported += 1

        except Exception:
            skip_reasons["error"] = skip_reasons.get("error", 0) + 1
            skipped += 1
            continue

    # Run grading if requested
    if body.run_grading and imported > 0:
        await queries.update_experiment_status(experiment_id, "grading")
        asyncio.create_task(_grade_production_experiment(experiment_id))
    elif imported > 0:
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
        "skip_reasons": skip_reasons,
    }


# ── Source extraction from guide text ────────────

def _extract_sources_from_guide(guide_text: str) -> list[dict]:
    """Extract sources from inline citations [[Name]](url) in guide text.

    Fallback for production traces where the agent emitted inline citations
    but no separate ```sources``` JSON block. Deduplicates by URL.
    """
    import re
    from urllib.parse import urlparse

    refs = re.findall(r'\[\[([^\]]+)\]\]\(([^)]+)\)', guide_text)
    if not refs:
        return []

    seen_urls: set[str] = set()
    sources = []
    for name, url in refs:
        url = url.strip()
        if url in seen_urls or not url.startswith("http"):
            continue
        seen_urls.add(url)

        try:
            domain = urlparse(url).netloc.lstrip("www.")
        except Exception:
            domain = ""

        sources.append({
            "type": "web",
            "title": name.strip(),
            "url": url,
            "domain": domain,
            "description": "",
        })

    return sources


# ── Helpers ──────────────────────────────────────

async def _get_imported_langfuse_ids() -> set[str]:
    """Get set of already-imported LangFuse trace IDs to avoid duplicates.

    Uses the model field convention: "langfuse:{trace_id}"
    """
    db = await queries.get_db()
    rows = await db.execute_fetchall(
        "SELECT model FROM traces WHERE model LIKE 'langfuse:%'"
    )
    ids = set()
    for r in rows:
        model = r["model"] or ""
        if model.startswith("langfuse:"):
            ids.add(model[len("langfuse:"):])
    return ids


def _extract_query(input_data) -> str:
    """Extract the user query from LangFuse trace input."""
    if isinstance(input_data, dict):
        return input_data.get("query", input_data.get("message", ""))
    elif isinstance(input_data, str):
        return input_data
    return ""


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

    if not isinstance(output, dict):
        return None

    query = _extract_query(input_data)
    if not query:
        return None

    guide_text = output.get("guide", "")
    case_key = _make_case_key(query)

    # Products and sources — handle both direct list and nested format
    products = output.get("products", [])
    if isinstance(products, str):
        try:
            import json
            products = json.loads(products)
        except Exception:
            products = []

    sources = output.get("sources", [])
    if isinstance(sources, str):
        try:
            import json
            sources = json.loads(sources)
        except Exception:
            sources = []

    # Fallback: extract sources from inline citations [[Name]](url) in guide text
    if not sources and guide_text:
        sources = _extract_sources_from_guide(guide_text)

    # Reconstruct basic events from output + metadata
    events = _reconstruct_events(lf_trace)

    # Hook metrics from metadata
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

    # Token usage
    usage = {}
    if hasattr(lf_trace, "usage"):
        usage = lf_trace.usage or {}
    elif metadata.get("usage"):
        usage = metadata["usage"]

    input_tokens = 0
    output_tokens = 0
    if isinstance(usage, dict):
        input_tokens = usage.get("input", usage.get("promptTokens", usage.get("input_tokens", 0))) or 0
        output_tokens = usage.get("output", usage.get("completionTokens", usage.get("output_tokens", 0))) or 0

    # Duration — output.elapsed_s is authoritative; fallback to LangFuse latency (in seconds)
    duration_s = output.get("elapsed_s", 0) or 0
    if not duration_s and lf_trace.latency:
        duration_s = lf_trace.latency  # already in seconds

    # Model — not on TraceWithDetails, use metadata
    model = metadata.get("model", "")

    # Turn count from observations
    turn_count = metadata.get("turn_count", 0)

    # Tool names from observations
    tool_names = metadata.get("tool_names", [])
    if not tool_names and events:
        seen = set()
        for ev in events:
            if isinstance(ev, dict) and ev.get("type") == "search_progress":
                tool = ev.get("tool", "")
                if tool and tool not in seen:
                    seen.add(tool)
                    tool_names.append(tool)

    return {
        "case_key": case_key,
        "query": query,
        "duration_s": duration_s,
        "guide_text": guide_text,
        "products": products,
        "sources": sources,
        "events": events,
        "hook_metrics": hook_metrics,
        "error_events": [],
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "turn_count": turn_count,
        "tool_names": tool_names,
        "prompt_version": metadata.get("prompt_version", ""),
    }


def _reconstruct_events(lf_trace) -> list[dict]:
    """Reconstruct SSE-like events from LangFuse trace output + metadata.

    LangFuse trace.list() returns observation IDs as strings (not full objects),
    so fetching individual observations would be too slow for batch import.
    Instead, we reconstruct basic events from the trace output and metadata,
    which is sufficient for most code graders.

    Graders that work with reconstructed events:
    - efficiency: needs product_found count (from output.products)
    - tool_calls: needs search_count (from metadata)
    - retrieval_quality: needs source domains (from metadata)
    - state_check: needs event sequence (basic reconstruction)
    """
    events = []
    output = lf_trace.output or {}
    metadata = lf_trace.metadata or {}

    if not isinstance(output, dict):
        return events

    # Reconstruct search_progress events from metadata search_count
    search_count = metadata.get("search_count", 0) if isinstance(metadata, dict) else 0
    for i in range(min(search_count, 30)):
        events.append({
            "type": "search_progress",
            "query": f"search-{i+1}",
            "phase": "search",
        })

    # Reconstruct product_found events from output.products
    products = output.get("products", [])
    if isinstance(products, list):
        for p in products[:20]:
            if isinstance(p, dict):
                events.append({
                    "type": "product_found",
                    "product": p,
                })

    # Reconstruct product_preview from output
    product_count = output.get("product_count", len(products) if isinstance(products, list) else 0)
    if product_count > 0:
        events.append({
            "type": "product_preview",
            "images": [],
            "count": product_count,
        })

    # search_meta from output
    events.append({
        "type": "search_meta",
        "products_viewed": product_count,
    })

    # text event (guide exists)
    if output.get("guide"):
        events.append({"type": "text", "content": "(production trace)"})

    # done event
    events.append({"type": "done"})

    return events


def _make_case_key(query: str) -> str:
    """Generate a case key from a query string."""
    key = query.lower().strip()
    key = re.sub(r"[^a-z0-9\u4e00-\u9fff\s-]", "", key)
    key = re.sub(r"\s+", "-", key)
    return key[:80]


async def _grade_production_experiment(experiment_id: int):
    """Grade production traces (background task).

    Production traces have no golden_data, so graders that require it
    (rubric_coverage, rubric_compliance, trap_detection) will be skipped
    by the pipeline's graceful degradation. Remaining graders still provide
    useful signal: source_authority, output_format, actionability, groundedness, etc.
    """
    try:
        await regrade_experiment(experiment_id)
    except Exception as e:
        logger.error(f"Production grading failed for experiment {experiment_id}: {e}")
        summary = await queries.compute_experiment_summary(experiment_id)
        await queries.update_experiment_status(
            experiment_id, "grading_failed",
            summary={**(summary.model_dump() if summary else {}), "grading_error": str(e)},
            finished_at=time.time(),
        )
