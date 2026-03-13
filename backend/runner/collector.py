"""SSE collector: streams from product backend and accumulates results.

Communicates with the product backend exclusively via HTTP SSE.
Zero Python imports from backend/.
"""

import json
import time
from dataclasses import dataclass, field

import httpx

from config import PRODUCT_API_URL, EVAL_API_KEY, COLLECT_TIMEOUT


@dataclass
class CollectedResult:
    guide_text: str = ""
    products: list[dict] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    hook_metrics: dict = field(default_factory=dict)
    error_events: list[dict] = field(default_factory=list)
    clarification: dict | None = None
    duration_s: float = 0.0
    prompt_version: str = ""
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    turn_count: int = 0
    system_prompt: str = ""
    tool_names: list[str] = field(default_factory=list)
    # Latency timestamps (seconds from request start)
    time_to_first_search: float = 0.0
    time_to_first_product: float = 0.0
    time_to_first_text: float = 0.0


async def collect_sse(
    query: str,
    history: list[dict] | None = None,
    timeout_s: int | None = None,
) -> CollectedResult:
    """Stream SSE from product backend and collect results.

    Args:
        query: The search query.
        history: Optional conversation history for follow-up queries.
        timeout_s: Override default timeout.

    Returns:
        CollectedResult with all accumulated data.
    """
    timeout = timeout_s or COLLECT_TIMEOUT
    result = CollectedResult()
    guide_parts: list[str] = []
    t0 = time.monotonic()

    url = f"{PRODUCT_API_URL}/api/internal/research"
    headers = {
        "X-Eval-Key": EVAL_API_KEY,
        "Content-Type": "application/json",
    }
    body = {"message": query, "history": history or []}

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=30.0)) as client:
        async with client.stream("POST", url, json=body, headers=headers) as resp:
            if resp.status_code != 200:
                text = await resp.aread()
                result.error_events.append({
                    "type": "error",
                    "message": f"HTTP {resp.status_code}: {text.decode()[:200]}",
                })
                result.duration_s = round(time.monotonic() - t0, 1)
                return result

            buffer = ""
            async for chunk in resp.aiter_text():
                buffer += chunk
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()

                    if not line or not line.startswith("data:"):
                        continue

                    data_str = line[5:].strip()
                    if not data_str:
                        continue

                    try:
                        event = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    event_type = event.get("type", "")
                    result.events.append(event)
                    elapsed = time.monotonic() - t0

                    if event_type == "text_delta":
                        if result.time_to_first_text == 0.0:
                            result.time_to_first_text = round(elapsed, 2)
                        guide_parts.append(event.get("content", ""))

                    elif event_type == "text":
                        if result.time_to_first_text == 0.0:
                            result.time_to_first_text = round(elapsed, 2)
                        guide_parts.append(event.get("content", ""))

                    elif event_type == "product_found":
                        product = event.get("product", {})
                        if product:
                            if result.time_to_first_product == 0.0:
                                result.time_to_first_product = round(elapsed, 2)
                            result.products.append(product)

                    elif event_type == "sources":
                        raw = event.get("sources", [])
                        if isinstance(raw, str):
                            try:
                                raw = json.loads(raw)
                            except (json.JSONDecodeError, ValueError):
                                raw = []
                        if isinstance(raw, list):
                            result.sources.extend(raw)

                    elif event_type == "search_progress":
                        if result.time_to_first_search == 0.0:
                            result.time_to_first_search = round(elapsed, 2)

                    elif event_type == "clarification":
                        result.clarification = event.get("question", event)

                    elif event_type == "error":
                        result.error_events.append(event)

                    elif event_type == "eval_meta":
                        result.hook_metrics = event.get("hook_metrics", {})
                        result.prompt_version = event.get("prompt_version", "")
                        result.model = event.get("model", "")
                        result.input_tokens = event.get("input_tokens", 0)
                        result.output_tokens = event.get("output_tokens", 0)
                        result.turn_count = event.get("turn_count", 0)
                        result.system_prompt = event.get("system_prompt", "")
                        result.tool_names = event.get("tool_names", [])

                    elif event_type == "done":
                        pass  # stream will end

    result.guide_text = "".join(guide_parts)
    result.duration_s = round(time.monotonic() - t0, 1)
    return result
