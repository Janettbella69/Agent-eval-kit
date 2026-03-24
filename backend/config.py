"""Eval platform configuration — independent of product backend."""

import hashlib
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

# Product backend URL (the system under test)
PRODUCT_API_URL = os.getenv("PRODUCT_API_URL", "http://localhost:8000")

# Shared secret for /api/internal/research
EVAL_API_KEY = os.getenv("EVAL_API_KEY", "")

# Anthropic API key — used by Claude Agent SDK (reads from env automatically)
# Kept here for reference; Agent SDK picks up ANTHROPIC_API_KEY from os.environ.
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# L2 grading model — MUST be stronger than the product orchestrator (claude-sonnet-4-6).
# Judge needs superior reasoning to catch errors the weaker model makes.
# Uses OpenRouter (ANTHROPIC_BASE_URL) to access cross-vendor models.
GRADING_MODEL = os.getenv("GRADING_MODEL", "openai/gpt-5.4")

# Scoring thresholds
PASS_THRESHOLD = int(os.getenv("PASS_THRESHOLD", "70"))

# L2 judge toggle
JUDGE_ENABLED = os.getenv("JUDGE_ENABLED", "").lower() in ("1", "true", "yes")

# Judge preset mode — Claude Code preset gives full autonomy (WebSearch, Bash, Read, etc.)
# but adds ~60s startup overhead and can timeout with OpenRouter models.
# Default: False (basic mode) — faster, reliable with OpenRouter, sufficient for scoring.
JUDGE_PRESET = os.getenv("JUDGE_PRESET", "false").lower() in ("1", "true", "yes")

# Judge max turns — preset mode needs more turns for verification workflows
JUDGE_MAX_TURNS_PRESET = int(os.getenv("JUDGE_MAX_TURNS_PRESET", "20"))
JUDGE_MAX_TURNS_BASIC = int(os.getenv("JUDGE_MAX_TURNS_BASIC", "10"))

# LangFuse — production trace import
LANGFUSE_SECRET_KEY = os.getenv("LANGFUSE_SECRET_KEY", "")
LANGFUSE_PUBLIC_KEY = os.getenv("LANGFUSE_PUBLIC_KEY", "")
LANGFUSE_BASE_URL = os.getenv("LANGFUSE_BASE_URL", "https://us.cloud.langfuse.com")

# Database
DB_PATH = Path(os.getenv("DB_PATH", str(Path(__file__).parent / "eval.db")))

# Collector timeout (seconds)
COLLECT_TIMEOUT = int(os.getenv("COLLECT_TIMEOUT", "900"))

# Server
HOST = os.getenv("EVAL_HOST", "0.0.0.0")
PORT = int(os.getenv("EVAL_PORT", "8100"))


# Judge prompt version hash — computed from grader prompts at startup
def _compute_judge_prompt_hash() -> str:
    """SHA-256 of all judge-related prompt files, truncated to 12 hex chars."""
    h = hashlib.sha256()
    grader_dir = Path(__file__).parent
    for filename in sorted(["graders/llm_graders.py", "agent/eval_agent.py"]):
        filepath = grader_dir / filename
        try:
            h.update(filepath.read_bytes())
        except FileNotFoundError:
            pass
    return h.hexdigest()[:12]

JUDGE_PROMPT_VERSION = _compute_judge_prompt_hash()
