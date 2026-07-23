"""LLM-powered graders (Agent-as-Judge) — deep investigation mode.

Four graders:
  1. rubric_compliance: Per-scene rubric evaluation (requires golden_data)
  2. trap_detection: Trap identification quality (requires trap_rubric)
  3. actionability: Can user make a purchase decision?
  4. groundedness: Are factual claims supported by cited sources?

Each returns GraderResult with 0-100 score.
All graders fail-open: return None on errors (pipeline handles gracefully).

When JUDGE_PRESET=true, each grader gets full Claude Code capabilities via the
preset="claude_code" system prompt in eval_agent.py. The prompts below become
the "append" portion, and the shared judge_capabilities() block is added automatically.

The graders receive the FULL agent operation log (search queries, URLs fetched,
errors, hook metrics, timing) — not just the final output. This gives the judge
"god's eye view" to evaluate both output quality and agent behavior.
"""

import json
import logging
from pathlib import Path
from urllib.parse import urlparse

from graders.types import GraderResult
from runner.collector import CollectedResult

logger = logging.getLogger(__name__)

# Max chars for guide text and operation log in LLM grader prompts.
# 12K guide ≈ 3K tokens — enough to capture comparison tables and summary sections
# that were lost at 6K. Total prompt stays under 8K tokens with golden data + oplog.
_MAX_GUIDE_CHARS = 12000
_MAX_OPLOG_CHARS = 4000

# Calibration few-shots directory — loaded from train set via extract_few_shots.py
_CALIBRATION_DIR = Path(__file__).resolve().parent.parent.parent / "calibration" / "few_shots"

# Error message patterns — short guide texts that are actually API/auth errors
_ERROR_PATTERNS = ("credit balance", "api error", "failed to authenticate", "author anthropic is banned",
                   "may not exist or you may not have access", "openrouter error")


def _is_error_message(text: str) -> bool:
    """Detect if guide text is actually an error message, not a real guide."""
    if len(text) > 500:
        return False
    lower = text.lower()
    return any(p in lower for p in _ERROR_PATTERNS)


def _load_few_shots(grader_name: str) -> str:
    """Load few-shot examples from calibration files. Returns empty string if not found."""
    path = _CALIBRATION_DIR / f"{grader_name}.json"
    if not path.exists():
        return ""
    try:
        examples = json.loads(path.read_text())
        if not isinstance(examples, list) or not examples:
            return ""
        lines = []
        for ex in examples:
            verdict = ex.get("verdict", "PASS" if ex.get("score", 0) >= 70 else "FAIL")
            reasoning = ex.get("reasoning", "")
            input_summary = ex.get("input_summary", "")
            lines.append(f'<example verdict="{verdict}">')
            if input_summary:
                lines.append(f"Input: {input_summary}")
            lines.append(f"Reasoning: {reasoning}")
            lines.append("</example>")
            lines.append("")
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"Failed to load few-shots for {grader_name}: {e}")
        return ""


# ── ShoppingComp annotation helpers ──────────────────────────────────

def _has_shoppingcomp_annotations(golden_data: dict) -> bool:
    """Return True if golden_data has ShoppingComp-style per-product expert annotations.

    ShoppingComp format: product_list[].scene_annotation_list[].reason + .reference
    These provide expert-verified specs and source URLs as ground truth.
    """
    product_list = golden_data.get("product_list", [])
    if not isinstance(product_list, list) or not product_list:
        return False
    first = product_list[0]
    if not isinstance(first, dict):
        return False
    sal = first.get("scene_annotation_list", [])
    if not isinstance(sal, list) or not sal:
        return False
    first_sa = sal[0]
    return isinstance(first_sa, dict) and bool(first_sa.get("reason") or first_sa.get("reference"))


def _build_shoppingcomp_golden_context(
    golden_data: dict,
    max_products: int = 3,
    max_scenes: int = 4,
    max_reason_chars: int = 350,
) -> str:
    """Build compact expert-annotated ground truth from ShoppingComp product_list.

    For each golden product, shows per-scene: rubric requirements, expert verification
    reasoning (reason), and expected source domains (reference.urls).

    Args:
        max_products: cap golden products shown (avoid prompt overflow)
        max_scenes: cap scenes per product
        max_reason_chars: truncate reason field (often very long)
    """
    product_list = golden_data.get("product_list", [])[:max_products]
    if not product_list:
        return ""

    blocks = ["## Ground Truth: Expert-Annotated Golden Products\n"]
    blocks.append("The following products were verified by domain experts against each rubric.\n")
    blocks.append("Use these as ground truth when evaluating the agent's claims.\n")

    for p in product_list:
        name = p.get("product_name", "Unknown")
        blocks.append(f"\n### Golden Product: **{name}**")

        sal = p.get("scene_annotation_list", [])[:max_scenes]
        for i, sa in enumerate(sal, 1):
            rubric = (sa.get("rubric") or "")[:250]
            reason = (sa.get("reason") or "")[:max_reason_chars]
            ref = sa.get("reference", {})
            ref_domains: list[str] = []
            if isinstance(ref, dict):
                for url in ref.get("urls", [])[:4]:
                    try:
                        domain = urlparse(url).netloc.lstrip("www.")
                        if domain:
                            ref_domains.append(domain)
                    except Exception:
                        pass

            blocks.append(f"\n**Scene {i} rubric**: {rubric}")
            if reason:
                blocks.append(f"**Expert verification** (ground truth): {reason}")
            if ref_domains:
                blocks.append(f"**Expected sources**: {', '.join(ref_domains)}")

    return "\n".join(blocks)


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
    if result.prompt_version:
        lines.append(f"**Prompt version**: {result.prompt_version}")
    if result.model:
        lines.append(f"**Model**: {result.model}")

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


# ── DB prompt override ────────────────────────────────────────────────

async def _get_prompt_from_db(grader_name: str) -> tuple[str | None, int]:
    """Try to load the active judge prompt from DB.

    Returns (prompt_text, version). (None, 0) means use code default.
    """
    try:
        from storage import queries
        prompt_data = await queries.get_active_judge_prompt(grader_name)
        if prompt_data and prompt_data.get("system_prompt"):
            logger.info(f"Judge prompt '{grader_name}' loaded from DB (v{prompt_data['version']})")
            return prompt_data["system_prompt"], prompt_data["version"]
    except Exception as e:
        logger.debug(f"DB prompt lookup failed for '{grader_name}': {e}")
    return None, 0


# ── LLM Grader runner ────────────────────────────────────────────────

async def _run_llm_grader(
    system_prompt: str,
    user_message: str,
    grader_name: str,
    weight: float,
    max_retries: int = 2,
) -> GraderResult | None:
    """Run an LLM grader via the eval agent with retry on failure.

    Prompt priority: DB active prompt > code-provided system_prompt.
    Retries up to max_retries times with exponential backoff on API errors.
    """
    import asyncio as _asyncio

    # Override prompt from DB if available; track version for traceability
    db_prompt, prompt_version = await _get_prompt_from_db(grader_name)
    if db_prompt:
        system_prompt = db_prompt

    last_error = None
    for attempt in range(1, max_retries + 2):  # 1-based, includes initial attempt
        try:
            from agent.eval_agent import run_eval_grader
            result = await run_eval_grader(system_prompt, user_message, grader_name)
            if result is None:
                logger.warning(f"LLM grader '{grader_name}' returned None (attempt {attempt}/{max_retries+1})")
                if attempt <= max_retries:
                    await _asyncio.sleep(2 ** attempt)
                    continue
                return None

            score = result.get("score", 0)
            verdict = result.get("result", "")
            reasoning = result.get("reasoning", "")
            details = result.get("details", {})
            details["reasoning"] = reasoning
            details["verdict"] = verdict
            details["system_prompt"] = system_prompt
            details["prompt_version"] = prompt_version
            details["prompt_source"] = "db" if prompt_version > 0 else "code"
            details["num_turns"] = result.get("num_turns", 0)
            if attempt > 1:
                details["retry_attempt"] = attempt

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
        except Exception as e:
            last_error = e
            logger.warning(f"LLM grader '{grader_name}' attempt {attempt}/{max_retries+1} failed: {e}")
            if attempt <= max_retries:
                await _asyncio.sleep(2 ** attempt)

    logger.error(f"LLM grader '{grader_name}' failed after {max_retries+1} attempts: {last_error}")
    return None


# ── Grader 1: Rubric Compliance ──────────────────────────────────────

async def grade_rubric_compliance(result: CollectedResult, golden_data: dict) -> GraderResult:
    """Agent-as-Judge: per-scene rubric compliance.

    Two modes (auto-detected from golden_data):
    - ShoppingComp mode: uses product_list with expert reason+reference as ground truth.
      Compares agent claims against verified specs, checks limitation disclosure.
    - Fallback mode: uses scene_list rubric text only (original behavior).
    """
    if _has_shoppingcomp_annotations(golden_data):
        return await _grade_rubric_compliance_shoppingcomp(result, golden_data)
    return await _grade_rubric_compliance_rubric_only(result, golden_data)


async def _grade_rubric_compliance_shoppingcomp(
    result: CollectedResult, golden_data: dict
) -> GraderResult:
    """ShoppingComp mode: evaluate using expert-annotated ground truth.

    Evaluates three things:
    1. Did the agent recommend the golden products (or equivalents)?
    2. Are the agent's spec claims consistent with expert verification?
    3. Did the agent disclose key limitations noted in expert analysis?
    """
    golden_context = _build_shoppingcomp_golden_context(golden_data)
    golden_names = [
        p.get("product_name", "")
        for p in golden_data.get("product_list", [])
    ]
    agent_products = [
        (p.get("name", "") if isinstance(p, dict) else str(p))
        for p in result.products[:10]
    ]

    calibrated_examples = _load_few_shots("rubric_compliance_shoppingcomp")
    if not calibrated_examples:
        calibrated_examples = """<example verdict="PASS">
Input: Golden product Sony Alpha 6700. Expert says: weight 493g (meets ≤500g), 4K 10-bit, but AF only EV-3 (falls short of required EV-4).
Agent recommended Sony Alpha 6700. Guide says: "493g body", "4K 4:2:2 10-bit", mentions "AF rated to EV-3, slightly below the EV-4 spec" as a limitation.
Reasoning: Agent found correct product, got key specs right, and disclosed the EV-3 limitation noted in expert analysis. Minor gap: didn't cite Sony spec page directly — not enough to fail.
</example>

<example verdict="FAIL">
Input: Golden product Sony Alpha 6700. Expert says: weight 493g, 4K 10-bit, AF EV-3 (not EV-4).
Agent recommended Sony ZV-E10. Guide says "excellent low-light" without specs. No mention of weight or AF limitations.
Reasoning: Wrong product recommended. Claims are vague and unverifiable against expert ground truth. Key limitation (AF shortfall) completely absent.
</example>"""

    system_prompt = f"""You are an eval judge for a shopping research guide. You have expert-verified ground truth.

## Task
Compare the agent's guide against expert-annotated golden products. Determine: PASS or FAIL.

## FAIL Definition
Agent missed all golden products AND recommended products that do NOT address the same use-case requirements in the rubric. Simply recommending different products is NOT automatic failure — the products must fail to meet the rubric's functional requirements.

## PASS Definition
Agent recommended products that satisfy the rubric's functional requirements. This includes:
- Golden products from the expert list, OR
- Equivalent alternatives that meet the same specs/requirements described in the rubric
- The key question is: "Do the recommended products solve the user's problem?" — not "Are they the exact same products as the expert list?"

## Output Format
Call `score_grader` with: grader_name="rubric_compliance", result="Pass" or "Fail", score=0-100 (your confidence — e.g. 80 for strong pass, 40 for borderline fail), reasoning.
Reasoning MUST state: (1) which golden products found or missed, (2) spec accuracy vs expert, (3) limitations disclosed or missed.

## Examples
{calibrated_examples}"""

    user_message = f"""{golden_context}

## Agent's Recommended Products ({len(agent_products)} found)
{chr(10).join(f"- {n}" for n in agent_products) if agent_products else "(none)"}

## Agent's Guide
{result.guide_text[:_MAX_GUIDE_CHARS]}

---
Compare the agent's output against the ground truth above.
Check: (1) were golden products recommended? (2) are spec claims accurate per expert verification? (3) were key limitations disclosed?
Determine Pass or Fail. Call score_grader with result, score (0-100), and reasoning."""

    r = await _run_llm_grader(system_prompt, user_message, "rubric_compliance", 0.15)
    if r is None:
        return GraderResult(name="rubric_compliance", score=0, weight=0.15,
                            category="llm", details={"skipped": True, "reason": "llm_error"})
    r.details["mode"] = "shoppingcomp"
    r.details["golden_products"] = golden_names
    return r


async def _grade_rubric_compliance_rubric_only(
    result: CollectedResult, golden_data: dict
) -> GraderResult:
    """Fallback mode: evaluate using rubric text only (original behavior)."""
    scene_list = golden_data.get("scene_list", [])
    if not scene_list:
        return GraderResult(name="rubric_compliance", score=0, weight=0.15,
                            category="llm", details={"skipped": True, "reason": "no scene_list"})

    scene_block = ""
    for i, scene in enumerate(scene_list, 1):
        scene_desc = scene.get("scene", "")
        rubric = scene.get("rubric", "")
        scene_block += f"\n### Scene {i}\n**Context:** {scene_desc[:200]}\n**Rubric:** {rubric[:300]}\n"

    # Load calibrated few-shots if available, otherwise use defaults
    calibrated_examples = _load_few_shots("rubric_compliance")
    if not calibrated_examples:
        calibrated_examples = """<example verdict="PASS">
Input: Rubric requires OLED vs LED comparison with input lag, HDR brightness, burn-in risk.
Reasoning: Guide covers OLED vs LED with input lag numbers (0.5ms vs 2ms), HDR brightness (800 vs 1500 nits), dedicated burn-in section. Missing VRR/HDMI 2.1 not in rubric — not penalized. 3/3 core rubric requirements addressed with evidence.
</example>

<example verdict="FAIL">
Input: Rubric requires OLED vs LED comparison with input lag, HDR brightness, burn-in risk.
Reasoning: Guide says "OLED TVs are great for gaming. LED TVs are more affordable." No specs, no numerical data, no substantive comparison. 0/3 rubric requirements addressed with evidence.
</example>"""

    system_prompt = f"""You are an eval judge for a shopping research guide.

## Task
Evaluate the guide against specific scene rubrics. Determine: PASS or FAIL.

## FAIL Definition
Guide misses >30% of rubric requirements, OR addresses them only superficially without specific evidence (numbers, specs, comparisons).

## PASS Definition
Guide addresses 70%+ of scene rubric requirements with specific evidence (product names, specs, measurements, source citations).

## Output Format
Call `score_grader` with: grader_name="rubric_compliance", result="Pass" or "Fail", score=0-100 (your confidence — e.g. 80 for strong pass, 40 for borderline fail), reasoning.
Reasoning MUST list: (1) total rubric requirements, (2) how many addressed with evidence, (3) which are missing.

## Examples
{calibrated_examples}"""

    user_message = f"""## Scenes and Rubrics
{scene_block}

## Guide Text
{result.guide_text[:_MAX_GUIDE_CHARS]}

---
Evaluate guide compliance against each scene rubric. Determine Pass or Fail based on evidence coverage."""

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

    calibrated_examples = _load_few_shots("trap_detection")
    if not calibrated_examples:
        calibrated_examples = """<example verdict="PASS">
Input: Trap — "Product X was recalled due to battery fire risk in 2024"
Reasoning: Guide explicitly warns "⚠️ Product X was recalled in late 2024 due to battery overheating" and offers alternatives Y and Z. Risk clearly identified with consequences. A reader would definitely notice this warning.
</example>

<example verdict="FAIL">
Input: Trap — "Product X was recalled due to battery fire risk in 2024"
Reasoning: Guide recommends "Product X is our top pick for portability! Great battery life." No mention of recall or fire risk. User would buy a recalled product without knowing.
</example>"""

    system_prompt = f"""You are an eval judge for trap/risk detection in a shopping guide.

## Task
Evaluate whether the guide correctly identifies a hidden trap/risk. Determine: PASS or FAIL.

## FAIL Definition
Guide recommends the product without mentioning the trap, OR only hints vaguely without explicit warning that a user would likely miss.

## PASS Definition
Guide explicitly identifies the hidden risk/trap AND explains consequences to the user. The warning must be clear enough that a reasonable reader would notice it.

## Output Format
Call `score_grader` with: grader_name="trap_detection", result="Pass" or "Fail", score=0-100, reasoning.
Reasoning MUST state: (1) was the risk mentioned? (2) how explicitly? (3) would a reader notice?

## Examples
{calibrated_examples}"""

    user_message = f"""## Hidden Risk (the agent should have discovered this through research)
{trap_rubric[:500]}

## Guide Text
{result.guide_text[:_MAX_GUIDE_CHARS]}

## Products Recommended
{len(result.products)} products found

---
Does the guide warn about this risk? Determine Pass or Fail."""

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

    calibrated_examples = _load_few_shots("actionability")
    if not calibrated_examples:
        calibrated_examples = """<example verdict="PASS">
Input: Guide with 4 headphone products.
Reasoning: Products with prices: 4/4 ($79, $129, $99, $149). Products with buy links: 3/4 (Amazon). Has audience segmentation: yes ("If you prioritize bass, get X; if comfort, get Y"). User can act immediately.
</example>

<example verdict="FAIL">
Input: Guide with 5 products mentioned.
Reasoning: Products with prices: 1/5. Products with buy links: 0/5. Has audience segmentation: no. Generic "available at major retailers" instead of specific links. User cannot make a purchase decision.
</example>"""

    system_prompt = f"""You are an eval judge for a shopping research guide's purchase actionability.

## Task
Evaluate whether the guide enables the user to make a purchase decision. Determine: PASS or FAIL.

## FAIL Definition
No actionable purchase path — prices missing for most products (>50%), no purchase links or retailer names, OR only generic "search Amazon" without specifics.

## PASS Definition
User can make a purchase decision — at least 50% of recommended products have current prices AND where-to-buy info (specific links or retailer names with product identifiers).

## Output Format
Call `score_grader` with: grader_name="actionability", result="Pass" or "Fail", score=0-100, reasoning.
Reasoning MUST count: (1) products with prices: X/Y, (2) products with buy links: X/Y, (3) has audience segmentation: yes/no.

## Examples
{calibrated_examples}"""

    user_message = f"""## Products Found
{products_summary}

## Guide Text
{result.guide_text[:_MAX_GUIDE_CHARS]}

---
Evaluate the guide's purchase actionability. Count products with prices and links. Determine Pass or Fail."""

    r = await _run_llm_grader(system_prompt, user_message, "actionability", 0.10)
    if r is None:
        return GraderResult(name="actionability", score=0, weight=0.10,
                            category="llm", details={"skipped": True, "reason": "llm_error"})
    return r


# ── Grader 4: Groundedness ─────────────────────────────────────

async def grade_groundedness(result: CollectedResult) -> GraderResult:
    """Agent-as-Judge: are factual claims in the guide supported by cited sources?

    This is the primary hallucination detector. The judge extracts factual claims
    from the guide, then checks each against the source list and guide citations.
    """
    if not result.guide_text or len(result.guide_text) < 200 or _is_error_message(result.guide_text):
        return GraderResult(name="groundedness", score=0, weight=0.15,
                            category="llm", details={"skipped": True, "reason": "no guide text"})

    # Build source context
    source_lines = []
    for i, s in enumerate(result.sources[:20], 1):
        if isinstance(s, dict):
            title = s.get("title", "")
            url = s.get("url", "")
            domain = s.get("domain", "")
            source_lines.append(f"[{i}] {title} — {domain} ({url})")
    sources_block = "\n".join(source_lines) if source_lines else "(no sources provided)"

    calibrated_examples = _load_few_shots("groundedness")
    if not calibrated_examples:
        calibrated_examples = """<example verdict="PASS">
Input: Guide about noise-cancelling headphones with 20 sources cited.
Reasoning: Extracted 15 factual claims. Claims checked: 15. Claims grounded: 13. "30-hour battery" cited [[RTINGS]] — confirmed. "$349 at Best Buy" — matches product data. 2 unverified: "most comfortable" (subjective, acceptable) and "charges in 1.5h" (no source, but not critical). No fabricated critical claims.
</example>

<example verdict="FAIL">
Input: Guide about tablets with 5 sources cited.
Reasoning: Extracted 12 factual claims. Claims checked: 12. Claims grounded: 4. "128GB storage" — actual is 64GB (fabricated spec). "$149 at Amazon" — no source supports this price. Critical fabrications: storage capacity and price both wrong. User would make a purchase based on false specs.
</example>"""

    system_prompt = f"""You are a groundedness evaluator for a shopping guide.

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
Call `score_grader` with: grader_name="groundedness", result="Pass" or "Fail", score=YOUR_GROUNDING_RATIO (NOT 0!), reasoning.
CRITICAL: The score parameter MUST be the grounding ratio as a number. If 67% of claims are grounded, score=67. If 90% grounded, score=90. NEVER send score=0 unless literally 0 claims are grounded.
Reasoning MUST include: (1) claims_checked: N, (2) claims_grounded: N, (3) grounding_ratio: N%, (4) critical_fabrications: list or "none".

## Examples
{calibrated_examples}"""

    user_message = f"""## Sources Cited ({len(result.sources)})
{sources_block}

## Guide Text
{result.guide_text[:_MAX_GUIDE_CHARS]}

## Products ({len(result.products)})
{', '.join(p.get('name', '?') if isinstance(p, dict) else str(p) for p in result.products[:10])}

---
Extract factual claims from the guide. Check each against the source list above.
Determine Pass or Fail based on grounding ratio and critical fabrications."""

    r = await _run_llm_grader(system_prompt, user_message, "groundedness", 0.15)
    if r is None:
        return GraderResult(name="groundedness", score=0, weight=0.15,
                            category="llm", details={"skipped": True, "reason": "llm_error"})
    return r
