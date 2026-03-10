#!/usr/bin/env python3
"""Eval platform CLI.

Usage:
    python eval/cli.py import --dataset legacy_v1
    python eval/cli.py run --dataset legacy_v1 [--cases en_clear,niche] [--tag v1.0] [--trials 1] [--concurrency 1]
    python eval/cli.py list
    python eval/cli.py summary --experiment-id 1
    python eval/cli.py regression --latest [--threshold 5]
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

# Add eval/backend to path for direct DB access
sys.path.insert(0, str(Path(__file__).parent / "backend"))


async def cmd_import(args):
    from storage.database import init_db
    from storage import queries

    await init_db()

    datasets_dir = Path(__file__).parent / "datasets"
    file_path = datasets_dir / f"{args.dataset}.json"
    if not file_path.exists():
        print(f"Error: {file_path} not found")
        return 1

    data = json.loads(file_path.read_text())
    name = data.get("name", args.dataset)
    description = data.get("description", "")
    cases = data.get("cases", [])

    existing = await queries.get_dataset_by_name(name)
    if existing:
        dataset_id = existing.id
        print(f"Updating existing dataset '{name}' (id={dataset_id})")
    else:
        dataset_id = await queries.create_dataset(name, description)
        print(f"Created dataset '{name}' (id={dataset_id})")

    for case in cases:
        await queries.upsert_case(
            dataset_id, case["key"], case["query"],
            case.get("type", "clear_en"), case.get("constraints", {}),
        )

    print(f"Imported {len(cases)} cases")
    return 0


async def cmd_run(args):
    from storage.database import init_db
    from storage import queries
    from runner.executor import run_experiment

    await init_db()

    # Find dataset
    dataset = await queries.get_dataset_by_name(args.dataset)
    if not dataset:
        print(f"Error: Dataset '{args.dataset}' not found. Run 'import' first.")
        return 1

    all_cases = await queries.get_cases(dataset.id)
    if args.cases:
        case_keys = set(args.cases.split(","))
        all_cases = [c for c in all_cases if c.key in case_keys]

    if not all_cases:
        print("Error: No matching cases found.")
        return 1

    config = {
        "cases": [c.key for c in all_cases],
        "trials": args.trials,
        "concurrency": args.concurrency,
    }
    experiment_id = await queries.create_experiment(dataset.id, args.tag or "", config)

    cases = [{"key": c.key, "query": c.query, "type": c.type,
              "constraints": c.constraints} for c in all_cases]

    print(f"Experiment #{experiment_id}: {len(cases)} cases × {args.trials} trials")
    print(f"  concurrency={args.concurrency}, tag='{args.tag or ''}'")
    print()

    t0 = time.time()
    await run_experiment(experiment_id, cases, concurrency=args.concurrency, trials=args.trials)
    elapsed = time.time() - t0

    # Print results
    summary = await queries.compute_experiment_summary(experiment_id)
    traces = await queries.get_experiment_traces(experiment_id)

    print()
    print("=" * 60)
    print(f"Experiment #{experiment_id} complete in {elapsed:.1f}s")
    print(f"  Avg Score: {summary.avg_score}")
    print(f"  Median:    {summary.median_score}")
    print(f"  Pass Rate: {summary.passed}/{summary.total_cases}")
    print(f"  Errored:   {summary.errored}")
    print()

    for t in traces:
        status = "✓ PASS" if t.final_pass else "✗ FAIL"
        print(f"  {status}  {t.case_key:20s}  score={t.final_score:5.1f}  {t.duration_s:6.1f}s")

    return 0


async def cmd_list(_args):
    from storage.database import init_db
    from storage import queries

    await init_db()
    experiments = await queries.list_experiments()

    if not experiments:
        print("No experiments found.")
        return 0

    print(f"{'ID':>4}  {'Tag':20s}  {'Status':10s}  {'Avg':>5}  {'Pass':>6}  {'Date'}")
    print("-" * 70)
    for e in experiments:
        avg = f"{e.summary.get('avg_score', 0):.1f}" if e.summary else "-"
        passed = e.summary.get("passed", 0) if e.summary else 0
        total = e.summary.get("total_cases", 0) if e.summary else 0
        pass_str = f"{passed}/{total}" if total else "-"
        date = time.strftime("%Y-%m-%d", time.localtime(e.created_at)) if e.created_at else "-"
        print(f"{e.id:4d}  {e.tag or '-':20s}  {e.status:10s}  {avg:>5}  {pass_str:>6}  {date}")

    return 0


async def cmd_summary(args):
    from storage.database import init_db
    from storage import queries

    await init_db()
    experiment = await queries.get_experiment(args.experiment_id)
    if not experiment:
        print(f"Error: Experiment #{args.experiment_id} not found.")
        return 1

    traces = await queries.get_experiment_traces(args.experiment_id)
    summary = await queries.compute_experiment_summary(args.experiment_id)

    print(f"Experiment #{experiment.id} (tag: {experiment.tag or '-'})")
    print(f"  Status:     {experiment.status}")
    print(f"  Avg Score:  {summary.avg_score}")
    print(f"  Median:     {summary.median_score}")
    print(f"  Pass Rate:  {summary.passed}/{summary.total_cases}")
    print(f"  Avg Duration: {summary.avg_duration}s")
    print()

    for t in traces:
        status = "✓" if t.final_pass else "✗"
        print(f"  {status} {t.case_key:20s}  score={t.final_score:5.1f}  {t.duration_s:6.1f}s  [{t.case_type}]")

    return 0


async def cmd_regression(args):
    from storage.database import init_db
    from storage import queries

    await init_db()
    experiments = await queries.list_experiments()
    completed = [e for e in experiments if e.status == "complete"]

    if len(completed) < 2:
        print("Need at least 2 completed experiments for regression check.")
        return 0

    latest = completed[0]
    previous = completed[1]

    latest_avg = latest.summary.get("avg_score", 0) if latest.summary else 0
    prev_avg = previous.summary.get("avg_score", 0) if previous.summary else 0
    delta = latest_avg - prev_avg

    print(f"Latest:   #{latest.id} (tag: {latest.tag or '-'}) avg={latest_avg:.1f}")
    print(f"Previous: #{previous.id} (tag: {previous.tag or '-'}) avg={prev_avg:.1f}")
    print(f"Delta:    {delta:+.1f}")

    threshold = args.threshold
    if delta < -threshold:
        print(f"\n*** REGRESSION DETECTED: avg dropped by {abs(delta):.1f} (threshold: {threshold}) ***")
        return 1
    else:
        print(f"\nNo regression (threshold: {threshold})")
        return 0


def main():
    parser = argparse.ArgumentParser(description="AIAzora Eval Platform CLI")
    subparsers = parser.add_subparsers(dest="command")

    # import
    p_import = subparsers.add_parser("import", help="Import dataset from JSON file")
    p_import.add_argument("--dataset", required=True, help="Dataset name (e.g., legacy_v1)")

    # run
    p_run = subparsers.add_parser("run", help="Run experiment")
    p_run.add_argument("--dataset", required=True, help="Dataset name")
    p_run.add_argument("--cases", default=None, help="Comma-separated case keys")
    p_run.add_argument("--tag", default="", help="Experiment tag")
    p_run.add_argument("--trials", type=int, default=1, help="Trials per case")
    p_run.add_argument("--concurrency", type=int, default=1, help="Parallel cases")

    # list
    subparsers.add_parser("list", help="List experiments")

    # summary
    p_summary = subparsers.add_parser("summary", help="Show experiment summary")
    p_summary.add_argument("--experiment-id", type=int, required=True)

    # regression
    p_regression = subparsers.add_parser("regression", help="Check for score regression")
    p_regression.add_argument("--latest", action="store_true", help="Compare latest two experiments")
    p_regression.add_argument("--threshold", type=float, default=5.0, help="Regression threshold")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return 1

    cmd_map = {
        "import": cmd_import,
        "run": cmd_run,
        "list": cmd_list,
        "summary": cmd_summary,
        "regression": cmd_regression,
    }

    return asyncio.run(cmd_map[args.command](args))


if __name__ == "__main__":
    sys.exit(main() or 0)
