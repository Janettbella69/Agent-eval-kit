"""Grader validation and calibration API endpoints."""

import time
from fastapi import APIRouter

from graders.validation import validate_grader_from_annotations
from graders.types import GRADER_DEFS

router = APIRouter(prefix="/api/graders", tags=["graders"])


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
