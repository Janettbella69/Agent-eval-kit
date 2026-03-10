"""Eval agent — Claude Agent SDK powered L2 judge.

Replaces the raw Anthropic API calls in l2_judge.py with an agent that can:
1. Holistically analyze the guide across all 5 dimensions
2. Verify source URLs with the verify_url tool
3. Record structured PASS/FAIL verdicts via score_dimension tool
"""

import asyncio

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    ResultMessage,
)

from agent.tools import create_eval_tools_server, init_scores, get_scores
from config import GRADING_MODEL
from graders.types import L2_DIMENSIONS


# ── System prompt ──

EVAL_AGENT_PROMPT = """You are an evaluation agent for a shopping research system.

Your task: evaluate a buyer's guide across 5 quality dimensions and record PASS/FAIL verdicts.

## Dimensions

{dimensions_block}

## Rules

1. Read the guide holistically before scoring any dimension.
2. Use the `verify_url` tool to spot-check 2-3 key source URLs for evidence_quality.
   - Don't check every URL. Focus on the most important claims.
   - If URLs are broken, factor that into your evidence_quality verdict.
3. Call `score_dimension` exactly once per dimension (5 calls total).
4. PASS = meets criteria adequately for a helpful shopping guide.
5. FAIL = clearly deficient on this dimension.
6. UNKNOWN = insufficient information to judge (e.g., empty guide).
7. Base your judgment on the guide content AND the automated evidence provided.
8. Be fair but rigorous. A guide doesn't need to be perfect to PASS.
9. After scoring all 5 dimensions, output a brief overall assessment (2-3 sentences).
"""


def _build_dimensions_block() -> str:
    """Format dimension definitions for the system prompt."""
    lines = []
    for i, dim in enumerate(L2_DIMENSIONS, 1):
        lines.append(f"{i}. **{dim.name}**: {dim.criteria}")
    return "\n".join(lines)


def _build_eval_message(
    query: str,
    guide_text: str,
    evidence_summary: str,
    products_summary: str,
    sources_summary: str,
) -> str:
    """Build the user message for the eval agent."""
    return f"""Evaluate this shopping research guide.

## User Query
{query}

## Automated Evidence (from L0/L1 graders)
{evidence_summary}

## Products Found
{products_summary}

## Sources Referenced
{sources_summary}

## Guide Text (first 8000 chars)
{guide_text[:8000]}

---

Now evaluate the guide. Verify a few key URLs, then score all 5 dimensions using the score_dimension tool."""


def _format_products(products: list) -> str:
    """Summarize products for the eval message."""
    if not products:
        return "No products found."
    lines = []
    for i, p in enumerate(products[:10], 1):
        name = p.get("name", "Unknown") if isinstance(p, dict) else str(p)
        price = p.get("price", "N/A") if isinstance(p, dict) else "N/A"
        brand = p.get("brand", "") if isinstance(p, dict) else ""
        lines.append(f"{i}. {name} ({brand}) — {price}")
    if len(products) > 10:
        lines.append(f"   ... and {len(products) - 10} more")
    return "\n".join(lines)


def _format_sources(sources: list) -> str:
    """Summarize sources for the eval message."""
    if not sources:
        return "No sources found."
    lines = []
    for i, s in enumerate(sources[:15], 1):
        if isinstance(s, dict):
            title = s.get("title", "Untitled")
            url = s.get("url", "")
            domain = s.get("domain", "")
            lines.append(f"{i}. [{title}]({url}) — {domain}")
        else:
            lines.append(f"{i}. {s}")
    if len(sources) > 15:
        lines.append(f"   ... and {len(sources) - 15} more")
    return "\n".join(lines)


async def run_eval_agent(
    query: str,
    guide_text: str,
    evidence_summary: str,
    products: list,
    sources: list,
) -> dict:
    """Run the eval agent and return L2 scores.

    Returns:
        {"dimensions": {"name": "PASS"|"FAIL"|"UNKNOWN"}, "l2_score": float | None}
    """
    init_scores()

    system_prompt = EVAL_AGENT_PROMPT.format(
        dimensions_block=_build_dimensions_block(),
    )

    tools_server = create_eval_tools_server()

    options = ClaudeAgentOptions(
        system_prompt=system_prompt,
        model=GRADING_MODEL,
        max_turns=10,
        permission_mode="bypassPermissions",
        allowed_tools=[
            "mcp__eval-tools__score_dimension",
            "mcp__eval-tools__verify_url",
        ],
        mcp_servers={"eval-tools": tools_server},
    )

    message = _build_eval_message(
        query=query,
        guide_text=guide_text,
        evidence_summary=evidence_summary,
        products_summary=_format_products(products),
        sources_summary=_format_sources(sources),
    )

    try:
        async with ClaudeSDKClient(options=options) as client:
            await client.query(message)
            async for msg in client.receive_response():
                if isinstance(msg, ResultMessage):
                    break
    except Exception:
        # Fail-open: return empty scores on agent errors
        pass

    # Collect scores from tool calls
    raw_scores = get_scores()

    dimensions = {}
    for dim in L2_DIMENSIONS:
        score_data = raw_scores.get(dim.name, {})
        if isinstance(score_data, dict):
            dimensions[dim.name] = score_data.get("verdict", "UNKNOWN")
        else:
            dimensions[dim.name] = "UNKNOWN"

    # Score: passes / (total - unknowns) * 100
    valid = [v for v in dimensions.values() if v != "UNKNOWN"]
    passes = sum(1 for v in valid if v == "PASS")
    l2_score = round(passes / len(valid) * 100, 1) if valid else None

    return {"dimensions": dimensions, "l2_score": l2_score}
