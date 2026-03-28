"""Grader validation, calibration, and judge prompt management API endpoints."""

import time
from pydantic import BaseModel
from fastapi import APIRouter

from graders.validation import validate_grader_from_annotations
from graders.types import GRADER_DEFS

router = APIRouter(prefix="/api/graders", tags=["graders"])


# ── Models ──

class SaveJudgePromptRequest(BaseModel):
    grader_name: str
    system_prompt: str
    few_shots: list = []
    notes: str = ""


@router.get("/definitions")
async def get_grader_definitions():
    """Get all grader definitions with weights and categories."""
    return [
        {
            "name": g.name,
            "weight": g.weight,
            "category": g.category,
            "requires_golden": g.requires_golden,
        }
        for g in GRADER_DEFS
    ]


@router.post("/{name}/validate")
async def validate_grader(name: str):
    """Run validation on a grader using existing human annotations.

    Computes confusion matrix, TPR/TNR, and checks deployment threshold.
    Requires human annotations to exist in traces.human_scores.
    """
    result = await validate_grader_from_annotations(name)

    # Store validation result
    from storage import queries
    db = await queries.get_db()
    await db.execute(
        """INSERT INTO grader_validations
           (grader_name, tpr, tnr, tp, fp, tn, fn, n_samples, threshold_met, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            name,
            result.get("tpr"),
            result.get("tnr"),
            result.get("tp", 0),
            result.get("fp", 0),
            result.get("tn", 0),
            result.get("fn", 0),
            result.get("n", 0),
            int(result.get("threshold_met", False)),
            time.time(),
        ),
    )
    await db.commit()

    return result


@router.get("/{name}/validation-history")
async def get_validation_history(name: str, limit: int = 10):
    """Get historical validation results for a grader."""
    from storage import queries
    db = await queries.get_db()
    rows = await db.execute_fetchall(
        """SELECT grader_name, tpr, tnr, tp, fp, tn, fn, n_samples,
                  threshold_met, created_at
           FROM grader_validations
           WHERE grader_name = ?
           ORDER BY created_at DESC
           LIMIT ?""",
        (name, limit),
    )
    return [
        {
            "grader_name": r[0],
            "tpr": r[1],
            "tnr": r[2],
            "tp": r[3], "fp": r[4], "tn": r[5], "fn": r[6],
            "n_samples": r[7],
            "threshold_met": bool(r[8]),
            "created_at": r[9],
        }
        for r in rows
    ]


@router.get("/validation-summary")
async def get_validation_summary():
    """Get latest validation status for all LLM graders."""
    from storage import queries
    db = await queries.get_db()

    llm_graders = [g.name for g in GRADER_DEFS if g.category == "llm"]
    summary = {}

    for name in llm_graders:
        rows = await db.execute_fetchall(
            """SELECT tpr, tnr, n_samples, threshold_met, created_at
               FROM grader_validations
               WHERE grader_name = ?
               ORDER BY created_at DESC
               LIMIT 1""",
            (name,),
        )
        if rows:
            r = rows[0]
            summary[name] = {
                "tpr": r[0],
                "tnr": r[1],
                "n_samples": r[2],
                "threshold_met": bool(r[3]),
                "last_validated": r[4],
            }
        else:
            summary[name] = {
                "tpr": None,
                "tnr": None,
                "n_samples": 0,
                "threshold_met": False,
                "last_validated": None,
            }

    return summary


# ── Judge Prompt Management ────────────────────

@router.get("/prompts")
async def list_judge_prompts(grader_name: str | None = None):
    """List all judge prompt versions, optionally filtered by grader."""
    from storage import queries
    return await queries.list_judge_prompts(grader_name)


@router.get("/prompts/{prompt_id}")
async def get_judge_prompt(prompt_id: int):
    """Get a specific judge prompt by ID (any version)."""
    from storage import queries
    prompt = await queries.get_judge_prompt_by_id(prompt_id)
    if not prompt:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={"detail": "Prompt not found."})
    return prompt


@router.get("/prompts/active/{grader_name}")
async def get_active_prompt(grader_name: str):
    """Get the currently active prompt for a grader. Returns null if using code default."""
    from storage import queries
    prompt = await queries.get_active_judge_prompt(grader_name)
    return {"grader_name": grader_name, "prompt": prompt, "source": "db" if prompt else "code_default"}


@router.post("/prompts")
async def save_judge_prompt(body: SaveJudgePromptRequest):
    """Save a new version of a judge prompt. Automatically becomes the active version.

    Previous versions are kept (is_active=0) for history and rollback.
    """
    from storage import queries
    result = await queries.save_judge_prompt(
        grader_name=body.grader_name,
        system_prompt=body.system_prompt,
        few_shots=body.few_shots,
        notes=body.notes,
    )
    return result


@router.post("/prompts/{prompt_id}/activate")
async def activate_prompt_version(prompt_id: int):
    """Rollback: re-activate a previous prompt version.

    Deactivates the current active version for this grader and activates the specified one.
    """
    from storage import queries
    prompt = await queries.get_judge_prompt_by_id(prompt_id)
    if not prompt:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={"detail": "Prompt not found."})

    db = await queries.get_db()
    # Deactivate all versions of this grader
    await db.execute(
        "UPDATE judge_prompts SET is_active = 0 WHERE grader_name = ?",
        (prompt["grader_name"],),
    )
    # Activate the specified version
    await db.execute(
        "UPDATE judge_prompts SET is_active = 1 WHERE id = ?",
        (prompt_id,),
    )
    await db.commit()

    return {
        "ok": True,
        "grader_name": prompt["grader_name"],
        "activated_version": prompt["version"],
    }


@router.get("/prompts/diff")
async def diff_prompt_versions(id_a: int, id_b: int):
    """Compare two prompt versions side-by-side.

    Returns both prompts with a line-level diff summary.
    """
    from storage import queries
    a = await queries.get_judge_prompt_by_id(id_a)
    b = await queries.get_judge_prompt_by_id(id_b)
    if not a or not b:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={"detail": "One or both prompts not found."})

    import difflib
    diff_lines = list(difflib.unified_diff(
        a["system_prompt"].splitlines(keepends=True),
        b["system_prompt"].splitlines(keepends=True),
        fromfile=f"{a['grader_name']} v{a['version']}",
        tofile=f"{b['grader_name']} v{b['version']}",
        n=3,
    ))

    added = sum(1 for l in diff_lines if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in diff_lines if l.startswith("-") and not l.startswith("---"))

    return {
        "a": {"id": a["id"], "grader_name": a["grader_name"], "version": a["version"],
               "is_active": a["is_active"], "system_prompt": a["system_prompt"]},
        "b": {"id": b["id"], "grader_name": b["grader_name"], "version": b["version"],
               "is_active": b["is_active"], "system_prompt": b["system_prompt"]},
        "diff": "".join(diff_lines),
        "stats": {"added": added, "removed": removed, "changed": added + removed > 0},
    }


@router.post("/prompts/seed")
async def seed_judge_prompts():
    """Seed DB with current hardcoded judge prompts (for first-time setup).

    Only seeds graders that don't already have a DB prompt.
    """
    from storage import queries
    from graders.llm_graders import (
        _load_few_shots,
    )

    # Hardcoded default prompts — extracted from llm_graders.py
    defaults = {
        "rubric_compliance": {
            "prompt": """You are an eval judge for a shopping research guide.

## Task
Evaluate the guide against specific scene rubrics. Determine: PASS or FAIL.

## FAIL Definition
Guide misses >30% of rubric requirements, OR addresses them only superficially without specific evidence (numbers, specs, comparisons).

## PASS Definition
Guide addresses 70%+ of scene rubric requirements with specific evidence (product names, specs, measurements, source citations).

## Output Format
Call `score_grader` with: grader_name="rubric_compliance", result="Pass" or result="Fail", reasoning.
Reasoning MUST list: (1) total rubric requirements, (2) how many addressed with evidence, (3) which are missing.""",
        },
        "groundedness": {
            "prompt": """You are a groundedness evaluator for a shopping guide.

## Task
Identify factual claims in the guide and check whether each is supported by cited sources. Determine: PASS or FAIL.

Note: You can only verify whether the source LIST contains relevant entries — you cannot access the actual source content. If a claim cites a source that appears in the list and the claim is plausible for that source type, treat it as grounded.

## FAIL Definition
<80% of factual claims grounded in cited sources, OR any critical claim (price, safety spec, compatibility) appears fabricated — contradicted by product data or absent from all sources.

## PASS Definition
80%+ of factual claims are grounded — either cited inline with a matching source, or consistent with product data. Minor unverified claims (subjective opinions, well-known facts) are acceptable.

## Protocol
1. Extract 10-15 factual claims (specs, prices, ratings, comparisons — NOT opinions)
2. For each: check if a cited source or product data supports it
3. Count: claims_grounded / claims_checked
4. Check: are there any CRITICAL fabrications? (wrong price, wrong safety spec, wrong compatibility)
   - A "critical fabrication" means the claim is CONTRADICTED by available data, not merely unverified
   - An unverified claim with no contradicting evidence is NOT a critical fabrication
5. Decision rule (MUST follow strictly):
   - If grounded/checked >= 0.8 AND zero critical fabrications → result="Pass"
   - If grounded/checked < 0.8 OR any critical fabrication exists → result="Fail"

## Output Format
Call `score_grader` with: grader_name="groundedness", result="Pass" or result="Fail", reasoning.
Reasoning MUST include: (1) claims_checked: N, (2) claims_grounded: N, (3) grounding_ratio: N%, (4) critical_fabrications: list or "none".""",
        },
        "actionability": {
            "prompt": """You are an eval judge for a shopping research guide's purchase actionability.

## Task
Evaluate whether the guide enables the user to make a purchase decision. Determine: PASS or FAIL.

## FAIL Definition
No actionable purchase path — prices missing for most products (>50%), no purchase links or retailer names, OR only generic "search Amazon" without specifics.

## PASS Definition
User can make a purchase decision — at least 50% of recommended products have current prices AND where-to-buy info (specific links or retailer names with product identifiers).

## Output Format
Call `score_grader` with: grader_name="actionability", result="Pass" or result="Fail", reasoning.
Reasoning MUST count: (1) products with prices: X/Y, (2) products with buy links: X/Y, (3) has audience segmentation: yes/no.""",
        },
        "trap_detection": {
            "prompt": """You are an eval judge for trap/risk detection in a shopping guide.

## Task
Evaluate whether the guide correctly identifies a hidden trap/risk. Determine: PASS or FAIL.

## FAIL Definition
Guide recommends the product without mentioning the trap, OR only hints vaguely without explicit warning that a user would likely miss.

## PASS Definition
Guide explicitly identifies the hidden risk/trap AND explains consequences to the user. The warning must be clear enough that a reasonable reader would notice it.

## Output Format
Call `score_grader` with: grader_name="trap_detection", result="Pass" or result="Fail", reasoning.
Reasoning MUST state: (1) was the risk mentioned? (2) how explicitly? (3) would a reader notice?""",
        },
    }

    seeded = []
    skipped = []
    for grader_name, config in defaults.items():
        existing = await queries.get_active_judge_prompt(grader_name)
        if existing:
            skipped.append(grader_name)
            continue
        few_shots = _load_few_shots(grader_name)
        await queries.save_judge_prompt(
            grader_name=grader_name,
            system_prompt=config["prompt"],
            few_shots=[],  # few_shots loaded from files at runtime
            notes="Seeded from hardcoded defaults",
        )
        seeded.append(grader_name)

    return {"seeded": seeded, "skipped": skipped}
