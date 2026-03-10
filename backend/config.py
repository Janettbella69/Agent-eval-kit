"""Eval platform configuration — independent of product backend."""

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

# L2 grading model
GRADING_MODEL = os.getenv("GRADING_MODEL", "claude-haiku-4-5-20251001")

# Scoring thresholds
PASS_THRESHOLD = int(os.getenv("PASS_THRESHOLD", "70"))

# L2 judge toggle
JUDGE_ENABLED = os.getenv("JUDGE_ENABLED", "").lower() in ("1", "true", "yes")

# Database
DB_PATH = Path(os.getenv("DB_PATH", str(Path(__file__).parent / "eval.db")))

# Collector timeout (seconds)
COLLECT_TIMEOUT = int(os.getenv("COLLECT_TIMEOUT", "900"))

# Server
HOST = os.getenv("EVAL_HOST", "0.0.0.0")
PORT = int(os.getenv("EVAL_PORT", "8100"))
