"""Eval agent tools — score recording and URL verification.

Tools are registered via @tool decorator and served as an in-process MCP server.
The eval agent calls these tools during its analysis of a shopping guide.
"""

from contextvars import ContextVar
from typing import Any

import httpx
from claude_agent_sdk import tool, create_sdk_mcp_server

# ── Shared state for collecting scores ──
_scores_var: ContextVar[dict | None] = ContextVar("eval_scores", default=None)


def init_scores():
    """Initialize a fresh scores dict for this eval run."""
    _scores_var.set({})


def get_scores() -> dict:
    """Retrieve collected scores."""
    return _scores_var.get() or {}


# ── Tools ──

@tool(
    "score_grader",
    "Record your numeric score (0-100) for this evaluation. "
    "You can call this multiple times — if self-reflection reveals issues, "
    "call again with your revised score. The LAST call is your final answer. "
    "Score 0-100 where 0=completely fails and 100=perfectly meets all criteria.",
    {
        "grader_name": str,
        "score": float,
        "reasoning": str,
    },
)
async def score_grader(args: dict[str, Any]) -> dict[str, Any]:
    scores = _scores_var.get()
    if scores is None:
        scores = {}
        _scores_var.set(scores)

    grader_name = args.get("grader_name", "").strip()
    score = args.get("score", 0)
    reasoning = args.get("reasoning", "")

    # Clamp score to 0-100
    try:
        score = max(0, min(100, float(score)))
    except (TypeError, ValueError):
        score = 0

    # Track revision history — last call wins
    existing = scores.get(grader_name)
    revision_num = 1
    revisions: list[dict] = []
    if existing and isinstance(existing, dict):
        revision_num = existing.get("revision_num", 1) + 1
        revisions = list(existing.get("revisions", []))
        revisions.append({
            "score": existing.get("score", 0),
            "reasoning": existing.get("reasoning", ""),
        })

    scores[grader_name] = {
        "score": score,
        "reasoning": reasoning,
        "revision_num": revision_num,
        "revisions": revisions,
    }

    response: dict[str, Any] = {"status": "recorded", "grader_name": grader_name, "score": score}
    if revision_num > 1:
        response["revised"] = True
        response["revision_num"] = revision_num
        response["previous_score"] = revisions[-1]["score"]
    return response


# Legacy tool — kept for backward compatibility with existing L2 judge
@tool(
    "score_dimension",
    "Record your PASS/FAIL verdict for a quality dimension. "
    "You MUST call this exactly once for each of the 5 dimensions: "
    "relevance, actionability, evidence_quality, completeness, objectivity. "
    "Include brief reasoning for your verdict.",
    {
        "dimension": str,
        "verdict": str,
        "reasoning": str,
    },
)
async def score_dimension(args: dict[str, Any]) -> dict[str, Any]:
    scores = _scores_var.get()
    if scores is None:
        scores = {}
        _scores_var.set(scores)

    dimension = args.get("dimension", "").strip().lower()
    verdict = args.get("verdict", "UNKNOWN").strip().upper()
    reasoning = args.get("reasoning", "")

    valid_dimensions = {"relevance", "actionability", "evidence_quality", "completeness", "objectivity"}
    if dimension not in valid_dimensions:
        return {"error": f"Invalid dimension '{dimension}'. Must be one of: {', '.join(sorted(valid_dimensions))}"}

    if verdict not in ("PASS", "FAIL", "UNKNOWN"):
        verdict = "UNKNOWN"

    scores[dimension] = {"verdict": verdict, "reasoning": reasoning}
    return {"status": "recorded", "dimension": dimension, "verdict": verdict}


@tool(
    "verify_url",
    "Check if a source URL is accessible. Returns HTTP status code. "
    "Use this to spot-check 2-3 key sources when evaluating evidence_quality. "
    "Do NOT check every URL — just the most important ones.",
    {
        "url": str,
    },
)
async def verify_url(args: dict[str, Any]) -> dict[str, Any]:
    url = args.get("url", "")
    if not url:
        return {"error": "url is required"}

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(8.0, connect=5.0),
            follow_redirects=True,
        ) as client:
            resp = await client.head(url)
            return {
                "url": url,
                "status": resp.status_code,
                "accessible": resp.status_code < 400,
            }
    except Exception as e:
        return {
            "url": url,
            "status": 0,
            "accessible": False,
            "error": str(e)[:100],
        }


def create_eval_tools_server():
    """Create an in-process MCP server with eval tools."""
    return create_sdk_mcp_server([score_grader, score_dimension, verify_url])
