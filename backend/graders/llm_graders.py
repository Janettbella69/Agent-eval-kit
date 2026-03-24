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
the "append" portion, and the shared JUDGE_CAPABILITIES block is added automatically.

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
# Prevents token overflow with long ShoppingComp rubrics + guide + operation log.
_MAX_GUIDE_CHARS = 6000
_MAX_OPLOG_CHARS = 2000

# Calibration few-shots directory — loaded from train set via extract_few_shots.py
_CALIBRATION_DIR = Path(__file__).resolve().parent.parent.parent / "calibration" / "few_shots"


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
            score = ex.get("score", 0)
            reasoning = ex.get("reasoning", "")
            input_summary = ex.get("input_summary", "")
            lines.append(f'<example verdict="{verdict}" score="{score}">')
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


# ── LLM Grader runner ────────────────────────────────────────────────

async def _run_llm_grader(
    system_prompt: str,
    user_message: str,
    grader_name: str,
    weight: float,
) -> GraderResult | None:
    """Run an LLM grader via the eval agent. Returns None on failure (logged)."""
    try:
        from agent.eval_agent import run_eval_grader
        result = await run_eval_grader(system_prompt, user_message, grader_name)
        if result is None:
            logger.warning(f"LLM grader '{grader_name}' returned None — agent failed or didn't call score_grader")
            return None

        score = result.get("score", 0)
        reasoning = result.get("reasoning", "")
        details = result.get("details", {})
        details["reasoning"] = reasoning
        details["system_prompt"] = system_prompt  # For judge prompt traceability
        details["num_turns"] = result.get("num_turns", 0)

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
    except Exception as e:
        logger.error(f"LLM grader '{grader_name}' exception: {e}")
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
        calibrated_examples = """<example verdict="PASS" score="85">
Input: Golden product Sony Alpha 6700. Expert says: weight 493g (meets ≤500g), 4K 10-bit, but AF only EV-3 (falls short of required EV-4).
Agent recommended Sony Alpha 6700. Guide says: "493g body", "4K 4:2:2 10-bit", mentions "AF rated to EV-3, slightly below the EV-4 spec" as a limitation.
Reasoning: Agent found correct product, got key specs right, and disclosed the EV-3 limitation noted in expert analysis. Minor gap: didn't cite Sony spec page directly.
</example>

<example verdict="FAIL" score="28">
Input: Golden product Sony Alpha 6700. Expert says: weight 493g, 4K 10-bit, AF EV-3 (not EV-4).
Agent recommended Sony ZV-E10. Guide says "excellent low-light" without specs. No mention of weight or AF limitations.
Reasoning: Wrong product recommended. Claims are vague and unverifiable against expert ground truth. Key limitation (AF shortfall) completely absent.
</example>"""

    system_prompt = f"""You are an eval judge for a shopping research guide. You have expert-verified ground truth.

## Task
Compare the agent's guide against expert-annotated golden products.
The ground truth contains: correct specs, why each product satisfies/fails rubric requirements, and expected source URLs.

## FAIL Definition
Agent either: (a) missed all golden products, OR (b) recommended golden products but stated incorrect specs or omitted critical limitations noted in expert analysis.

## PASS Definition
Agent recommended at least one golden product AND claims are consistent with expert verification — correct key specs, key limitations disclosed.

## Output Format
Call `score_grader` with: grader_name="rubric_compliance", score (0-100), reasoning.
Reasoning must state: which golden products found, spec accuracy vs expert, limitations disclosed/missed.

## Examples
{calibrated_examples}

## Scoring Guide
- 90-100: Correct products, spec claims match expert analysis, key limitations disclosed
- 70-89: Correct products, mostly accurate, minor omissions
- 50-69: Correct products found, but significant spec errors or missing limitations
- 30-49: Wrong products or mostly incorrect specs
- 0-29: No golden products found"""

    user_message = f"""{golden_context}

## Agent's Recommended Products ({len(agent_products)} found)
{chr(10).join(f"- {n}" for n in agent_products) if agent_products else "(none)"}

## Agent's Guide
{result.guide_text[:_MAX_GUIDE_CHARS]}

---
Compare the agent's output against the ground truth above.
Check: (1) were golden products recommended? (2) are spec claims accurate per expert verification? (3) were key limitations disclosed?
Call score_grader with your assessment."""

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
        calibrated_examples = """<example verdict="PASS" score="82">
Input: Rubric requires OLED vs LED comparison with input lag, HDR brightness, burn-in risk.
Reasoning: Guide covers OLED vs LED with input lag numbers (0.5ms vs 2ms), HDR brightness (800 vs 1500 nits), dedicated burn-in section. Missing VRR/HDMI 2.1 not in rubric — not penalized.
</example>

<example verdict="FAIL" score="40">
Input: Rubric requires OLED vs LED comparison with input lag, HDR brightness, burn-in risk.
Reasoning: Guide says "OLED TVs are great for gaming. LED TVs are more affordable." No specs, no numerical data, no substantive comparison. Rubric requirements largely unaddressed.
</example>"""

    system_prompt = f"""You are an eval judge for a shopping research guide.

## Task
Evaluate the guide against specific scene rubrics. Score each scene, then compute an average.

## FAIL Definition
Guide misses >30% of rubric requirements, OR addresses them only superficially without specific evidence (numbers, specs, comparisons).

## PASS Definition
Guide addresses 70%+ of scene rubric requirements with specific evidence (product names, specs, measurements, source citations).

## Output Format
Call `score_grader` with: grader_name="rubric_compliance", score (0-100), reasoning.
Reasoning must list which rubric items are covered vs missing.

## Examples
{calibrated_examples}

## Scoring Guide
- 90-100: All rubric requirements clearly addressed with specific evidence
- 70-89: Most requirements addressed, minor gaps
- 50-69: Some requirements addressed but significant gaps
- 30-49: Few requirements addressed
- 0-29: Rubric largely ignored"""

    user_message = f"""## Scenes and Rubrics
{scene_block}

## Guide Text
{result.guide_text[:_MAX_GUIDE_CHARS]}

---
Evaluate guide compliance against each scene rubric. Score based on what is in the output."""

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
        calibrated_examples = """<example verdict="PASS" score="92">
Input: Trap — "Product X was recalled due to battery fire risk in 2024"
Reasoning: Guide explicitly warns "⚠️ Product X was recalled in late 2024 due to battery overheating" and offers alternatives Y and Z. Risk clearly identified with consequences.
</example>

<example verdict="FAIL" score="15">
Input: Trap — "Product X was recalled due to battery fire risk in 2024"
Reasoning: Guide recommends "Product X is our top pick for portability! Great battery life." No mention of recall or fire risk. User would buy a recalled product.
</example>"""

    system_prompt = f"""You are an eval judge for trap/risk detection in a shopping guide.

## Task
Evaluate whether the guide correctly identifies a hidden trap/risk that the agent should have discovered.

## FAIL Definition
Guide recommends the product without mentioning the trap, OR only hints vaguely without explicit warning.

## PASS Definition
Guide explicitly identifies the hidden risk/trap AND explains consequences to the user.

## Output Format
Call `score_grader` with: grader_name="trap_detection", score (0-100), reasoning.
Reasoning must state whether the risk was identified and how clearly.

## Examples
{calibrated_examples}

## Scoring Guide
- 90-100: Explicitly identifies the risk, explains consequences, offers alternatives
- 70-89: Mentions the risk but doesn't fully explain consequences
- 50-69: Hints at the issue indirectly without clear warning
- 30-49: Brief mention that could be easily missed
- 0-29: Completely fails to identify or warn about the risk"""

    user_message = f"""## Hidden Risk (the agent should have discovered this through research)
{trap_rubric[:500]}

## Guide Text
{result.guide_text[:_MAX_GUIDE_CHARS]}

## Products Recommended
{len(result.products)} products found

---
Does the guide warn about this risk? Score based on warning quality in the output."""

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
        calibrated_examples = """<example verdict="PASS" score="88">
Input: Guide with 4 headphone products.
Reasoning: 4 products with specific prices ($79, $129, $99, $149), Amazon links for 3/4, clear segmentation "If you prioritize bass, get X; if comfort, get Y". User can act immediately.
</example>

<example verdict="FAIL" score="30">
Input: Guide with 5 products mentioned.
Reasoning: Only 1 of 5 products has a price. No purchase links. Generic "available at major retailers" instead of specific links. User cannot make a purchase decision from this guide.
</example>"""

    system_prompt = f"""You are an eval judge for a shopping research guide's purchase actionability.

## Task
Evaluate whether the guide enables the user to make a purchase decision.

## FAIL Definition
No actionable purchase path — prices missing for most products, links broken or absent, OR only generic "search Amazon" without specifics.

## PASS Definition
User can make a purchase decision — at least 2 products have current prices AND where-to-buy info (specific links or retailer names).

## Output Format
Call `score_grader` with: grader_name="actionability", score (0-100), reasoning.
Reasoning must count: how many products have prices? How many have buy links? Is there audience segmentation?

## Examples
{calibrated_examples}

## Scoring Guide
- 90-100: Clear recommendations, current prices, buy links, good segmentation
- 70-89: Good recommendations and prices, minor gaps
- 50-69: Some recommendations but lacks prices or clear buying guidance
- 30-49: Mostly informational, hard to act on
- 0-29: No actionable purchase guidance"""

    user_message = f"""## Products Found
{products_summary}

## Guide Text
{result.guide_text[:_MAX_GUIDE_CHARS]}

---
Evaluate the guide's purchase actionability based on what appears in the output above.
Do products have prices? Are there buy links? Are recommendations clear and segmented?
Call score_grader with your score and reasoning."""

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
    if not result.guide_text or len(result.guide_text) < 200:
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
        calibrated_examples = """<example verdict="PASS" score="85">
Input: Guide about noise-cancelling headphones with 20 sources cited.
Reasoning: Extracted 20 factual claims. "30-hour battery" cited [[RTINGS]]. "$349 at Best Buy" matches product data. 17/20 grounded. 3 minor claims (weight, color options) unverified but plausible. No fabricated critical claims.
</example>

<example verdict="FAIL" score="35">
Input: Guide about tablets with 5 sources cited.
Reasoning: Extracted 20 claims. "128GB storage" — actual is 64GB (fabricated spec). "$149 at Amazon" — no source supports this price. 8/20 grounded. Multiple fabricated specs and prices. Critical claims unsupported.
</example>"""

    system_prompt = f"""You are a groundedness evaluator for a shopping guide.

## Task
Identify factual claims in the guide and check whether each is supported by cited sources.

## FAIL Definition
<80% of factual claims grounded in cited sources, OR critical claims (price, safety, specs) are fabricated.

## PASS Definition
80%+ of factual claims are grounded — either cited inline with a matching source, or matching product data.

## Output Format
Call `score_grader` with: grader_name="groundedness", score (0-100), reasoning.
Reasoning must list: total claims extracted, number grounded, number ungrounded, worst violations.

## Protocol
1. Extract 10-15 factual claims (specs, prices, ratings, comparisons — NOT opinions)
2. For each: check if a cited source or product data supports it
3. Score = (grounded / total) × 100

## Examples
{calibrated_examples}

## Scoring Guide
- 90-100: Nearly all claims have clear source support
- 70-89: Most claims grounded, a few unsupported details
- 50-69: Significant number of unsupported claims
- 30-49: Many claims appear fabricated
- 0-29: Guide appears largely hallucinated"""

    user_message = f"""## Sources Cited ({len(result.sources)})
{sources_block}

## Guide Text
{result.guide_text[:_MAX_GUIDE_CHARS]}

## Products ({len(result.products)})
{', '.join(p.get('name', '?') if isinstance(p, dict) else str(p) for p in result.products[:10])}

---
Extract factual claims from the guide. Check each against the source list above.
Score based on what percentage of claims are supported by cited sources."""

    r = await _run_llm_grader(system_prompt, user_message, "groundedness", 0.15)
    if r is None:
        return GraderResult(name="groundedness", score=0, weight=0.15,
                            category="llm", details={"skipped": True, "reason": "llm_error"})
    return r
