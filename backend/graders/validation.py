"""Judge validation: TPR/TNR measurement and Rogan-Gladen bias correction.

Per Hamel Husain's validate-evaluator methodology:
- TPR (True Positive Rate): when human says Pass, how often does judge agree?
- TNR (True Negative Rate): when human says Fail, how often does judge agree?
- Threshold: TPR >= 80% AND TNR >= 80% for deployment
- Rogan-Gladen corrects aggregate pass rates for known judge bias
"""

import logging

logger = logging.getLogger(__name__)

VALIDATION_TPR_THRESHOLD = 0.80
VALIDATION_TNR_THRESHOLD = 0.80


def compute_confusion_matrix(
    predictions: list[str],
    labels: list[str],
) -> dict:
    """Compute confusion matrix from predicted and human-labeled verdicts.

    Args:
        predictions: Judge verdicts ("Pass" or "Fail")
        labels: Human ground truth ("Pass" or "Fail")

    Returns dict with tp, fp, tn, fn, tpr, tnr, precision, recall, f1, n.
    """
    tp = fp = tn = fn = 0
    for pred, label in zip(predictions, labels):
        p = pred.lower().startswith("pass")
        l = label.lower().startswith("pass")
        if p and l:
            tp += 1
        elif p and not l:
            fp += 1
        elif not p and l:
            fn += 1
        else:
            tn += 1

    tpr = tp / (tp + fn) if (tp + fn) > 0 else None
    tnr = tn / (tn + fp) if (tn + fp) > 0 else None
    precision = tp / (tp + fp) if (tp + fp) > 0 else None
    recall = tpr
    f1 = (2 * precision * recall / (precision + recall)) if precision and recall else None

    return {
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "tpr": round(tpr, 4) if tpr is not None else None,
        "tnr": round(tnr, 4) if tnr is not None else None,
        "precision": round(precision, 4) if precision is not None else None,
        "recall": round(recall, 4) if recall is not None else None,
        "f1": round(f1, 4) if f1 is not None else None,
        "n": len(predictions),
    }


def rogan_gladen_correction(p_obs: float, tpr: float, tnr: float) -> float | None:
    """Rogan-Gladen bias correction for aggregate pass rate.

    corrected = (p_obs + TNR - 1) / (TPR + TNR - 1)

    Returns None if denominator is zero (useless classifier).
    """
    denom = tpr + tnr - 1
    if abs(denom) < 1e-6:
        return None
    corrected = (p_obs + tnr - 1) / denom
    return round(max(0, min(1, corrected)), 4)


def check_threshold(tpr: float | None, tnr: float | None) -> bool:
    """Check if TPR and TNR meet minimum deployment thresholds."""
    if tpr is None or tnr is None:
        return False
    return tpr >= VALIDATION_TPR_THRESHOLD and tnr >= VALIDATION_TNR_THRESHOLD


async def validate_grader_from_annotations(grader_name: str) -> dict:
    """Validate a grader using existing human annotations.

    Collects all traces where human_scores[grader_name] exists,
    extracts auto verdict from composite_scores[grader_name].details.verdict,
    and computes confusion matrix.

    Returns validation result dict.
    """
    from storage import queries
    import json

    db = await queries._get_db()
    rows = await db.execute_fetchall(
        """SELECT id, composite_scores, human_scores
           FROM traces
           WHERE human_scores IS NOT NULL
             AND human_scores != '{}'
             AND composite_scores IS NOT NULL
             AND composite_scores != '{}'""",
    )

    predictions: list[str] = []
    labels: list[str] = []

    for row in rows:
        try:
            composite = json.loads(row[1]) if isinstance(row[1], str) else row[1]
            human = json.loads(row[2]) if isinstance(row[2], str) else row[2]
        except (json.JSONDecodeError, TypeError):
            continue

        # Extract auto verdict
        grader_data = composite.get(grader_name, {})
        if not grader_data:
            continue
        auto_verdict = grader_data.get("details", {}).get("verdict", "")
        if not auto_verdict:
            # Fallback: infer from score
            auto_score = grader_data.get("score", 0)
            auto_verdict = "Pass" if auto_score >= 70 else "Fail"

        # Extract human verdict
        human_data = human.get(grader_name, {})
        if not human_data:
            continue
        if isinstance(human_data, dict):
            human_score = human_data.get("score", 0)
        else:
            human_score = float(human_data) if human_data else 0
        human_verdict = "Pass" if human_score >= 70 else "Fail"

        predictions.append(auto_verdict)
        labels.append(human_verdict)

    if len(predictions) < 5:
        return {
            "grader_name": grader_name,
            "n": len(predictions),
            "error": f"Insufficient annotations ({len(predictions)}). Need at least 5.",
            "threshold_met": False,
        }

    matrix = compute_confusion_matrix(predictions, labels)
    matrix["grader_name"] = grader_name
    matrix["threshold_met"] = check_threshold(matrix["tpr"], matrix["tnr"])

    # Compute corrected rate if possible
    if matrix["tpr"] is not None and matrix["tnr"] is not None:
        p_obs = sum(1 for p in predictions if p.lower().startswith("pass")) / len(predictions)
        matrix["observed_pass_rate"] = round(p_obs, 4)
        matrix["corrected_pass_rate"] = rogan_gladen_correction(p_obs, matrix["tpr"], matrix["tnr"])

    return matrix
