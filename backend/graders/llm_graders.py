"""LLM-powered graders (Agent-as-Judge) — deep investigation mode.

Three graders:
  1. rubric_compliance: Per-scene rubric evaluation (requires golden_data)
  2. trap_detection: Trap identification quality (requires trap_rubric)
  3. actionability: Can user make a purchase decision?

Each returns GraderResult with 0-100 score.
All graders fail-open: return None on errors (pipeline handles gracefully).

When JUDGE_PRESET=true, each grader gets full Claude Code capabilities via the
preset="claude_code" system prompt in eval_agent.py. The prompts below become
the "append" portion, and the shared JUDGE_CAPABILITIES block is added automatically.

The graders receive the FULL agent operation log (search queries, URLs fetched,
errors, hook metrics, timing) — not just the final output. This gives the judge
"god's eye view" to evaluate both output quality and agent behavior.
"""

from graders.types import GraderResult
from runner.collector import CollectedResult


# ── Investigation context builder ─────────────────────────────────────

def _build_operation_log(result: CollectedResult) -> str:
    """Build a structured agent operation log from the SSE event stream.

    This gives the judge "god's eye view" of the agent's entire research process:
    - What searches were performed (and in what order)
    - What URLs were fetched (and which failed)
    - Product discovery funnel (previewed → found → final)
    - Error events and their context
    - Hook metrics (if available)
    - Phase timing breakdown
    """
    lines = []
    lines.append("## Agent Operation Log (God's Eye View)\n")
    lines.append(f"**Total duration**: {result.duration_s}s")
    lines.append(f"**Total events**: {len(result.events)}")

    # ── Extract event data ──
    search_queries: list[str] = []
    fetch_urls: list[str] = []
    product_names: list[str] = []
    preview_counts: list[int] = []
    errors: list[str] = []
    text_chunks = 0
    clarification_asked = False

    # Phase timing (if timestamps available)
    phase_events: dict[str, list[float]] = {}
    base_ts = 0.0

    for i, e in enumerate(result.events):
        t = e.get("type", "")
        ts = e.get("_ts", 0) or e.get("timestamp", 0) or 0
        if i == 0 and ts:
            base_ts = ts

        rel_s = round((ts - base_ts) / 1000, 1) if ts and base_ts else None

        if t == "search_progress":
            q = e.get("query", e.get("phase", ""))
            if q and q not in search_queries:
                search_queries.append(q)
            phase_events.setdefault("search", []).append(rel_s or 0)

        elif t == "product_found":
            p = e.get("product", {})
            name = p.get("name", "Unknown") if isinstance(p, dict) else str(p)
            product_names.append(name)
            phase_events.setdefault("products", []).append(rel_s or 0)

        elif t == "product_preview":
            preview_counts.append(e.get("count", 0))

        elif t in ("text", "text_delta"):
            text_chunks += 1
            phase_events.setdefault("generate", []).append(rel_s or 0)

        elif t == "error":
            errors.append(e.get("message", "unknown error")[:150])

        elif t == "clarification":
            clarification_asked = True

        elif t == "sources":
            phase_events.setdefault("sources", []).append(rel_s or 0)

    # ── Search Queries ──
    lines.append(f"\n### Search Queries ({len(search_queries)} unique)")
    for i, q in enumerate(search_queries[:20], 1):
        lines.append(f"  {i}. {q}")
    if len(search_queries) > 20:
        lines.append(f"  ... +{len(search_queries) - 20} more")

    # ── Product Discovery Funnel ──
    max_preview = max(preview_counts) if preview_counts else 0
    lines.append(f"\n### Product Funnel")
    lines.append(f"- Products previewed (peak): {max_preview}")
    lines.append(f"- Products extracted: {len(product_names)}")
    lines.append(f"- Products in final output: {len(result.products)}")
    lines.append(f"- Sources in final output: {len(result.sources)}")
    if product_names:
        lines.append(f"- Product names: {', '.join(product_names[:10])}")
        if len(product_names) > 10:
            lines.append(f"  ... +{len(product_names) - 10} more")

    # ── Errors ──
    if errors:
        lines.append(f"\n### Errors ({len(errors)})")
        for err in errors[:5]:
            lines.append(f"  ⚠ {err}")

    # ── Hook Metrics ──
    if result.hook_metrics:
        lines.append(f"\n### Hook Metrics (from product agent)")
        for k, v in sorted(result.hook_metrics.items()):
            lines.append(f"- {k}: {v}")

    # ── Phase Timing ──
    if any(phase_events.values()):
        lines.append(f"\n### Phase Breakdown")
        for phase_name in ["search", "products", "generate", "sources"]:
            timestamps = phase_events.get(phase_name, [])
            if timestamps and any(t > 0 for t in timestamps):
                first = min(t for t in timestamps if t > 0) if any(t > 0 for t in timestamps) else 0
                last = max(timestamps)
                lines.append(f"- {phase_name}: {first:.1f}s → {last:.1f}s ({len(timestamps)} events)")

    # ── Flags ──
    flags = []
    if clarification_asked:
        flags.append("clarification_asked")
    if errors:
        flags.append(f"errors:{len(errors)}")
    if len(search_queries) < 3:
        flags.append("few_searches")
    if len(search_queries) > 15:
        flags.append("many_searches")
    if not result.products:
        flags.append("no_products")
    if not result.sources:
        flags.append("no_sources")
    if len(result.guide_text) < 500:
        flags.append("short_guide")

    if flags:
        lines.append(f"\n### Flags: {', '.join(flags)}")

    return "\n".join(lines)


# ── LLM Grader runner ────────────────────────────────────────────────

async def _run_llm_grader(
    system_prompt: str,
    user_message: str,
    grader_name: str,
    weight: float,
) -> GraderResult | None:
    """Run an LLM grader via the eval agent. Returns None on failure."""
    try:
        from agent.eval_agent import run_eval_grader
        result = await run_eval_grader(system_prompt, user_message, grader_name)
        if result is None:
            return None

        score = result.get("score", 0)
        reasoning = result.get("reasoning", "")
        details = result.get("details", {})
        details["reasoning"] = reasoning

        # Store self-correction metadata
        revision_num = result.get("revision_num", 1)
        revisions = result.get("revisions", [])
        if revision_num > 1:
            details["revision_count"] = revision_num
            details["revisions"] = revisions

        return GraderResult(
            name=grader_name,
            score=float(score),
            weight=weight,
            category="llm",
            details=details,
        )
    except Exception:
        return None


# ── Grader 1: Rubric Compliance ──────────────────────────────────────

async def grade_rubric_compliance(result: CollectedResult, golden_data: dict) -> GraderResult:
    """Agent-as-Judge: per-scene rubric compliance with full operation context."""
    scene_list = golden_data.get("scene_list", [])
    if not scene_list:
        return GraderResult(name="rubric_compliance", score=0, weight=0.15,
                            category="llm", details={"skipped": True, "reason": "no scene_list"})

    scene_block = ""
    for i, scene in enumerate(scene_list, 1):
        scene_desc = scene.get("scene", "")
        rubric = scene.get("rubric", "")
        scene_block += f"\n### Scene {i}\n**Context:** {scene_desc[:300]}\n**Rubric:** {rubric[:500]}\n"

    operation_log = _build_operation_log(result)

    system_prompt = """You are a deep-investigation eval agent for a shopping research system.

## Your Advantage
You have "god's eye view" — you see not only the final guide, but the FULL agent
operation log: every search query, every URL fetched, every error, exact timing.
You also have Claude Code capabilities to read the agent's source code and verify claims.

## Task
Evaluate the guide against specific scene rubrics. Score each scene 0-100 and compute an average.

## Investigation Protocol
1. **Read the operation log** — understand what the agent actually did:
   - Did it search for the right things given the rubric requirements?
   - Were there errors that caused information gaps?
   - Did it have enough search diversity to cover the rubric?
2. **Read the guide** — check rubric compliance scene by scene.
3. **Investigate gaps** — if the guide misses a rubric requirement:
   - Check the operation log: did the agent even search for it?
   - If it searched but failed: URL error? Extraction failure? → partial credit
   - If it never searched: research strategy failure → lower score
4. **Score** — call `score_grader` with per-scene scores and root cause analysis.
5. **Verify** — WebSearch 1-2 key claims. Read prompts.py to check quality gate compliance.
6. **Reflect & revise** — if verification contradicts your score, call score_grader again.

## Scoring Guide
- 90-100: All rubric requirements clearly addressed with specific evidence
- 70-89: Most requirements addressed, minor gaps
- 50-69: Some requirements addressed but significant gaps
- 30-49: Few requirements addressed
- 0-29: Rubric largely ignored

## Source Code Reference
- `/home/ubuntu/aiazora/backend/agent/prompts.py` — what the agent was instructed to do
- `/home/ubuntu/aiazora/backend/agent/hooks.py` — how hooks guide research (entity tracking, dimension coverage)"""

    user_message = f"""## Scenes and Rubrics
{scene_block}

{operation_log}

## Guide Text (first 8000 chars)
{result.guide_text[:8000]}

---
Investigate the operation log, evaluate scene compliance, verify key claims, then score.
If your investigation reveals the agent missed rubric requirements due to search strategy
failures (visible in the operation log), factor that into your score."""

    r = await _run_llm_grader(system_prompt, user_message, "rubric_compliance", 0.15)
    if r is None:
        return GraderResult(name="rubric_compliance", score=0, weight=0.15,
                            category="llm", details={"skipped": True, "reason": "llm_error"})
    return r


# ── Grader 2: Trap Detection ────────────────────────────────────────

async def grade_trap_detection(result: CollectedResult, golden_data: dict) -> GraderResult:
    """Agent-as-Judge: trap detection with full operation context."""
    trap_rubric = golden_data.get("trap_rubric", "")
    if not trap_rubric:
        return GraderResult(name="trap_detection", score=0, weight=0.10,
                            category="llm", details={"skipped": True, "reason": "no trap_rubric"})

    operation_log = _build_operation_log(result)

    system_prompt = """You are a deep-investigation eval agent evaluating trap detection.

## Your Advantage
You see the agent's FULL operation log — every search query, URL, error, timing.
You can trace whether the agent even encountered the trap information during research.

## Task
Evaluate whether the guide correctly identifies a hidden trap/risk.

## Investigation Protocol
1. **Analyze the operation log**:
   - Did the agent search for terms related to the trap? (check search queries)
   - Did it access sources that discuss this issue? (check URLs)
   - If it searched but didn't warn: the agent saw the info but didn't synthesize it
   - If it never searched: the agent's research strategy missed this angle entirely
2. **Read the guide** — does it warn about the trap?
3. **Score** — call `score_grader` based on both output quality AND research strategy.
4. **WebSearch the trap topic** to see if it's widely known. If widely known but
   the agent missed it, that's a worse failure than missing an obscure issue.
5. **Reflect & revise** — if verification changes your assessment, call score_grader again.

## Scoring Guide
- 90-100: Explicitly identifies the risk, explains consequences, offers alternatives
- 70-89: Mentions the risk but doesn't fully explain consequences
- 50-69: Hints at the issue indirectly without clear warning
- 30-49: Brief mention that could be easily missed
- 0-29: Completely fails to identify or warn about the risk"""

    user_message = f"""## Hidden Risk (from rubric — the agent should NOT have seen this directly)
{trap_rubric}

{operation_log}

## Guide Text
{result.guide_text[:8000]}

## Products Recommended
{len(result.products)} products found

---
Investigate: did the agent's search queries (in operation log) even touch on this trap topic?
Then evaluate the guide's warning quality. Score and verify."""

    r = await _run_llm_grader(system_prompt, user_message, "trap_detection", 0.10)
    if r is None:
        return GraderResult(name="trap_detection", score=0, weight=0.10,
                            category="llm", details={"skipped": True, "reason": "llm_error"})
    return r


# ── Grader 3: Actionability ─────────────────────────────────────────

async def grade_actionability(result: CollectedResult) -> GraderResult:
    """Agent-as-Judge: actionability with full operation context."""
    products_summary = "No products found."
    if result.products:
        lines = []
        for i, p in enumerate(result.products[:8], 1):
            name = p.get("name", "?") if isinstance(p, dict) else str(p)
            price = p.get("price", "N/A") if isinstance(p, dict) else "N/A"
            url = p.get("purchaseUrl", "") if isinstance(p, dict) else ""
            lines.append(f"{i}. {name} — {price}" + (f" [{url[:60]}]" if url else ""))
        products_summary = "\n".join(lines)

    operation_log = _build_operation_log(result)

    system_prompt = """You are a deep-investigation eval agent evaluating purchase actionability.

## Your Advantage
You see the agent's FULL operation log — search queries, URLs, errors, timing.
You can determine if the agent spent enough effort on pricing and purchase information.

## Task
Evaluate whether the guide enables the user to make a purchase decision.

## Dimensions (weight each equally)
1. **Recommendations**: Clear "buy this if..." recommendations (not info dumps)
2. **Pricing**: Current prices prominently shown
3. **Purchase paths**: Links or instructions on where to buy
4. **Audience segmentation**: "For X use case, get Y"

## Investigation Protocol
1. **Analyze the operation log**:
   - Did the agent search for pricing info? (look for "price", "buy", "deal" in queries)
   - Did it access retailer sites? (Amazon, Best Buy, etc. in URLs)
   - How many product extraction events vs search events? (ratio indicates depth)
2. **Spot-check prices** — WebSearch 1-2 product names, compare prices to guide.
3. **Score** — call `score_grader` with dimension breakdown.
4. **Reflect** — are your verified prices consistent with your score? Revise if needed.

## Scoring Guide
- 90-100: Clear recommendations, current prices, buy links, good segmentation
- 70-89: Good recommendations and prices, minor gaps
- 50-69: Some recommendations but lacks prices or clear buying guidance
- 30-49: Mostly informational, hard to act on
- 0-29: No actionable purchase guidance"""

    user_message = f"""## Products Found
{products_summary}

{operation_log}

## Guide Text (first 8000 chars)
{result.guide_text[:8000]}

---
Investigate the operation log for pricing/purchase research effort.
Spot-check 1-2 prices via WebSearch. Score actionability and verify."""

    r = await _run_llm_grader(system_prompt, user_message, "actionability", 0.10)
    if r is None:
        return GraderResult(name="actionability", score=0, weight=0.10,
                            category="llm", details={"skipped": True, "reason": "llm_error"})
    return r
