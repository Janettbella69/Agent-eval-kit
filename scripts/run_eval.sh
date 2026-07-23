#!/bin/bash
# run_eval.sh — Server-side eval runner for CI and scheduled jobs.
#
# Usage:
#   eval/scripts/run_eval.sh regression [--tag ci-abc1234]     # Quick 5-case regression
#   eval/scripts/run_eval.sh capability [--tag weekly-20260315] # Full capability eval
#   eval/scripts/run_eval.sh smoke                              # 2-case smoke test
#
# Exit codes:
#   0 = passed (or no regression)
#   1 = regression detected / error
#   2 = eval platform not available

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
EVAL_DIR="$PROJECT_DIR/eval"
BACKEND_DIR="$EVAL_DIR/backend"
DB_PATH="$BACKEND_DIR/eval.db"

# Default settings
MODE="${1:-regression}"
TAG=""
THRESHOLD=5
CONCURRENCY=2
TRIALS=1

# Parse flags
shift || true
while [[ $# -gt 0 ]]; do
    case $1 in
        --tag) TAG="$2"; shift 2 ;;
        --threshold) THRESHOLD="$2"; shift 2 ;;
        --concurrency) CONCURRENCY="$2"; shift 2 ;;
        --trials) TRIALS="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# Auto-generate tag from git commit if not provided
if [[ -z "$TAG" ]]; then
    GIT_SHA=$(cd "$PROJECT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    TAG="${MODE}-${GIT_SHA}-$(date +%Y%m%d)"
fi

echo "=========================================="
echo "  AIAzora Eval Runner"
echo "  Mode: $MODE"
echo "  Tag: $TAG"
echo "=========================================="

# Check product backend is running
echo "Checking product backend..."
if ! curl -sf --max-time 5 http://localhost:8000/ > /dev/null 2>&1; then
    # Try Docker internal network
    if ! curl -sf --max-time 5 http://172.18.0.2:80/ > /dev/null 2>&1; then
        echo "ERROR: Product backend not reachable"
        exit 2
    fi
fi
echo "✅ Product backend is up"

# Ensure eval database exists (init if needed)
cd "$BACKEND_DIR"
python3 -c "
import asyncio, sys
sys.path.insert(0, '.')
from storage.database import init_db, close_db
async def main():
    await init_db()
    print('✅ Eval database ready')
    await close_db()
asyncio.run(main())
"

# Select dataset and cases based on mode
case "$MODE" in
    smoke)
        DATASET="Legacy Baseline V1"
        CASES="en_clear,comparison"
        CONCURRENCY=1
        echo "Smoke test: 2 cases"
        ;;
    regression)
        DATASET="Legacy Baseline V1"
        CASES=""  # All cases in dataset
        echo "Regression check: all cases in Legacy Baseline"
        ;;
    capability)
        DATASET="Legacy Baseline V1"
        CASES=""  # All cases
        TRIALS=2
        echo "Capability eval: all cases × ${TRIALS} trials"
        ;;
    *)
        echo "Unknown mode: $MODE (use smoke|regression|capability)"
        exit 1
        ;;
esac

# Import dataset if not exists
python3 -c "
import asyncio, sys
sys.path.insert(0, '.')
from storage.database import init_db, close_db
from storage import queries
async def check():
    await init_db()
    try:
        ds = await queries.get_dataset_by_name('$DATASET')
        if ds:
            print(f'Dataset exists: {ds.name} ({ds.case_count} cases)')
        else:
            print('Dataset not found — importing...')
            # Import via CLI
            import subprocess
            subprocess.run(['python3', '$EVAL_DIR/cli.py', 'import', '--dataset', 'legacy_v1'], check=True)
            print('Imported.')
    finally:
        await close_db()
asyncio.run(check())
"

# Build CLI args
CLI_ARGS="--dataset \"$DATASET\" --tag \"$TAG\" --concurrency $CONCURRENCY --trials $TRIALS"
if [[ -n "$CASES" ]]; then
    CLI_ARGS="$CLI_ARGS --cases $CASES"
fi

echo ""
echo "Running: python3 $EVAL_DIR/cli.py run $CLI_ARGS"
echo ""

# Run experiment
eval "python3 $EVAL_DIR/cli.py run $CLI_ARGS"
RUN_EXIT=$?

if [[ $RUN_EXIT -ne 0 ]]; then
    echo "ERROR: Experiment failed (exit $RUN_EXIT)"
    exit 1
fi

# Regression check (compare latest two experiments)
if [[ "$MODE" == "regression" || "$MODE" == "capability" ]]; then
    echo ""
    echo "Running regression check (threshold: $THRESHOLD)..."
    python3 "$EVAL_DIR/cli.py" regression --latest --threshold "$THRESHOLD"
    REGRESSION_EXIT=$?

    if [[ $REGRESSION_EXIT -ne 0 ]]; then
        echo ""
        echo "⚠️  REGRESSION DETECTED — score dropped by more than $THRESHOLD points"
        exit 1
    else
        echo "✅ No regression detected"
    fi
fi

echo ""
echo "=========================================="
echo "  Eval complete: $TAG"
echo "=========================================="
exit 0
