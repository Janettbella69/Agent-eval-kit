"""Experiment management routes."""

import asyncio
import subprocess
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from storage import queries
from storage.models import ExperimentIn
from runner.executor import run_experiment, request_stop, regrade_experiment

router = APIRouter(prefix="/api/experiments", tags=["experiments"])


def _get_git_commit() -> str:
    """Get current git commit hash (short). Returns empty string on failure."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except Exception:
        return ""


@router.get("")
async def list_experiments():
    return await queries.list_experiments()


# IMPORTANT: /compare MUST be before /{experiment_id} to avoid path param conflict
@router.get("/compare")
async def compare_experiments_endpoint(base: int, target: int):
    """Compare two experiments case-by-case: improved, regressed, unchanged."""
    base_exp = await queries.get_experiment(base)
    target_exp = await queries.get_experiment(target)
    if not base_exp:
        return JSONResponse(status_code=404, content={"detail": f"Base experiment #{base} not found."})
    if not target_exp:
        return JSONResponse(status_code=404, content={"detail": f"Target experiment #{target} not found."})

    result = await queries.compare_experiments(base, target)
    return result


@router.post("")
async def create_experiment(body: ExperimentIn):
    """Create a new experiment (does not start it)."""
    dataset = await queries.get_dataset(body.dataset_id)
    if not dataset:
        return JSONResponse(status_code=404, content={"detail": "Dataset not found."})

    # Auto-capture git commit, prompt version, and model info
    git_commit = _get_git_commit()
    try:
        from config import PROMPT_VERSION
        prompt_version = PROMPT_VERSION
    except (ImportError, AttributeError):
        prompt_version = ""

    # Auto-detect model names from config if not explicitly provided
    model = body.model
    grading_model = body.grading_model
    if not model:
        try:
            from config import PRODUCT_API_URL
            import os
            model = os.getenv("ORCHESTRATOR_MODEL", "claude-sonnet-4-6")
        except Exception:
            pass
    if not grading_model:
        try:
            from config import GRADING_MODEL
            grading_model = GRADING_MODEL
        except Exception:
            pass

    config = {
        "cases": body.cases,
        "trials": body.trials,
        "concurrency": body.concurrency,
        "judge_enabled": body.judge_enabled,
        "git_commit": git_commit,
        "prompt_version": prompt_version,
        "notes": body.notes,
        "mode": body.mode,
        "model": model,
        "grading_model": grading_model,
        "system_prompt": body.system_prompt,
    }
    experiment_id = await queries.create_experiment(body.dataset_id, body.tag, config)

    # Auto-run if requested
    if body.auto_run:
        all_cases = await queries.get_cases(body.dataset_id)
        case_filter = body.cases
        if case_filter:
            all_cases = [c for c in all_cases if c.key in case_filter]
        cases = [{"key": c.key, "query": c.query, "type": c.type,
                  "constraints": c.constraints, "golden_data": c.golden_data} for c in all_cases]
        asyncio.create_task(
            run_experiment(experiment_id, cases, concurrency=body.concurrency,
                           trials=body.trials, model=model, system_prompt=body.system_prompt)
        )
        return {"id": experiment_id, "status": "running", "cases": len(cases)}

    return {"id": experiment_id}


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: int):
    experiment = await queries.get_experiment(experiment_id)
    if not experiment:
        return JSONResponse(status_code=404, content={"detail": "Experiment not found."})

    traces = await queries.get_experiment_traces(experiment_id)
    return {
        **experiment.model_dump(),
        "traces": [t.model_dump() for t in traces],
    }


@router.post("/{experiment_id}/run")
async def run_experiment_endpoint(experiment_id: int):
    """Start running an experiment in the background."""
    experiment = await queries.get_experiment(experiment_id)
    if not experiment:
        return JSONResponse(status_code=404, content={"detail": "Experiment not found."})

    if experiment.status == "running":
        return JSONResponse(status_code=409, content={"detail": "Experiment already running."})

    # Load cases (with golden_data)
    all_cases = await queries.get_cases(experiment.dataset_id)
    case_filter = experiment.config.get("cases")
    if case_filter:
        all_cases = [c for c in all_cases if c.key in case_filter]

    cases = [{"key": c.key, "query": c.query, "type": c.type,
              "constraints": c.constraints, "golden_data": c.golden_data} for c in all_cases]

    trials = experiment.config.get("trials", 1)
    concurrency = experiment.config.get("concurrency", 1)
    model = experiment.config.get("model", "")
    system_prompt = experiment.config.get("system_prompt", "")

    # Run in background
    asyncio.create_task(
        run_experiment(experiment_id, cases, concurrency=concurrency, trials=trials,
                       model=model, system_prompt=system_prompt)
    )

    return {"status": "started", "cases": len(cases), "trials": trials, "model": model or "(default)"}


@router.post("/{experiment_id}/stop")
async def stop_experiment(experiment_id: int):
    """Request graceful stop of a running experiment."""
    experiment = await queries.get_experiment(experiment_id)
    if not experiment:
        return JSONResponse(status_code=404, content={"detail": "Experiment not found."})

    request_stop(experiment_id)
    return {"status": "stop_requested"}


@router.post("/{experiment_id}/regrade")
async def regrade_experiment_endpoint(experiment_id: int):
    """Re-grade all collected traces with current grading pipeline."""
    experiment = await queries.get_experiment(experiment_id)
    if not experiment:
        return JSONResponse(status_code=404, content={"detail": "Experiment not found."})

    count = await regrade_experiment(experiment_id)
    return {"status": "regraded", "traces_regraded": count}


@router.get("/{experiment_id}/summary")
async def get_experiment_summary(experiment_id: int):
    """Get aggregated experiment summary with pass@k metrics."""
    experiment = await queries.get_experiment(experiment_id)
    if not experiment:
        return JSONResponse(status_code=404, content={"detail": "Experiment not found."})

    summary = await queries.compute_experiment_summary(experiment_id)
    return summary.model_dump()


# ── Cron / Automation Endpoint ──────────────────────────────

class CronRunRequest(BaseModel):
    dataset_id: int
    model: str = ""                 # orchestrator model override
    system_prompt: str = ""         # prompt override
    tag_prefix: str = "cron"        # auto-generates tag: cron-2026-03-25-sonnet
    cases: list[str] | None = None  # subset of case keys; None = all
    cases_count: int | None = None  # random sample N cases (alternative to explicit list)
    trials: int = 1
    concurrency: int = 2
    judge_enabled: bool = True


@router.post("/cron-run")
async def cron_run_experiment(body: CronRunRequest, request: Request):
    """Create and auto-run an experiment. Designed for cron/CI/CD automation.

    Secured by X-Eval-Key header (same as product backend eval endpoint).

    Usage:
        curl -X POST http://localhost:8100/api/experiments/cron-run \\
          -H "X-Eval-Key: ..." \\
          -H "Content-Type: application/json" \\
          -d '{"dataset_id": 3, "model": "claude-sonnet-4-6", "cases_count": 5}'
    """
    from config import EVAL_API_KEY
    eval_key = request.headers.get("X-Eval-Key", "")
    if EVAL_API_KEY and eval_key != EVAL_API_KEY:
        return JSONResponse(status_code=403, content={"detail": "Invalid eval API key."})

    dataset = await queries.get_dataset(body.dataset_id)
    if not dataset:
        return JSONResponse(status_code=404, content={"detail": "Dataset not found."})

    # Build tag
    from datetime import datetime
    model_short = body.model.split("/")[-1][:20] if body.model else "default"
    tag = f"{body.tag_prefix}-{datetime.now().strftime('%Y%m%d-%H%M')}-{model_short}"

    # Load cases
    all_cases = await queries.get_cases(body.dataset_id)
    if body.cases:
        all_cases = [c for c in all_cases if c.key in body.cases]
    elif body.cases_count and body.cases_count < len(all_cases):
        import random
        all_cases = random.sample(all_cases, body.cases_count)

    cases = [{"key": c.key, "query": c.query, "type": c.type,
              "constraints": c.constraints, "golden_data": c.golden_data} for c in all_cases]

    if not cases:
        return JSONResponse(status_code=422, content={"detail": "No cases found."})

    config = {
        "cases": [c["key"] for c in cases],
        "trials": body.trials,
        "concurrency": body.concurrency,
        "judge_enabled": body.judge_enabled,
        "model": body.model,
        "system_prompt": body.system_prompt,
        "git_commit": _get_git_commit(),
        "mode": "benchmark",
    }
    experiment_id = await queries.create_experiment(body.dataset_id, tag, config)

    asyncio.create_task(
        run_experiment(experiment_id, cases, concurrency=body.concurrency,
                       trials=body.trials, model=body.model, system_prompt=body.system_prompt)
    )

    return {
        "id": experiment_id,
        "tag": tag,
        "status": "running",
        "cases": len(cases),
        "model": body.model or "(default)",
    }
