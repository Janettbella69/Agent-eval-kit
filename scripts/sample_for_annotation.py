"""Sample traces for human annotation — score-stratified + random.

Usage:
    python scripts/sample_for_annotation.py --experiment-id 64 --count 50

Outputs trace IDs for annotation, stratified by score buckets to ensure
diverse Pass/Fail representation.
"""

import argparse
import json
import random
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "backend" / "eval.db"


def sample_traces(experiment_id: int, count: int = 50, seed: int = 42) -> list[dict]:
    random.seed(seed)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    # Get all valid traces (guide > 1000 chars, graded)
    rows = db.execute("""
        SELECT id, case_key, case_type, final_score, final_pass,
               LENGTH(guide_text) as guide_len,
               json_array_length(COALESCE(products, '[]')) as n_products,
               human_pass
        FROM traces
        WHERE experiment_id = ?
          AND LENGTH(COALESCE(guide_text, '')) > 1000
          AND composite_scores IS NOT NULL AND composite_scores != '{}'
          AND human_pass IS NULL
        ORDER BY final_score
    """, (experiment_id,)).fetchall()

    if not rows:
        print(f"No valid unannotated traces in experiment {experiment_id}")
        return []

    traces = [dict(r) for r in rows]
    print(f"Pool: {len(traces)} valid unannotated traces")

    # Score-stratified sampling
    buckets = {
        "0-30": [t for t in traces if t["final_score"] < 30],
        "30-50": [t for t in traces if 30 <= t["final_score"] < 50],
        "50-70": [t for t in traces if 50 <= t["final_score"] < 70],
        "70+": [t for t in traces if t["final_score"] >= 70],
    }

    for name, bucket in buckets.items():
        print(f"  {name}: {len(bucket)} traces")

    # Allocate proportionally, minimum 3 per non-empty bucket
    per_bucket = max(3, count // len([b for b in buckets.values() if b]))
    sampled = []
    for name, bucket in buckets.items():
        if not bucket:
            continue
        n = min(per_bucket, len(bucket))
        sampled.extend(random.sample(bucket, n))

    # Fill remaining with random from unselected
    sampled_ids = {t["id"] for t in sampled}
    remaining = [t for t in traces if t["id"] not in sampled_ids]
    if len(sampled) < count and remaining:
        extra = min(count - len(sampled), len(remaining))
        sampled.extend(random.sample(remaining, extra))

    sampled = sampled[:count]
    random.shuffle(sampled)

    print(f"\nSampled {len(sampled)} traces for annotation:")
    for t in sampled[:10]:
        print(f"  Trace #{t['id']}: score={t['final_score']:.1f}, type={t['case_type']}, "
              f"guide={t['guide_len']}c, products={t['n_products']}")
    if len(sampled) > 10:
        print(f"  ... +{len(sampled) - 10} more")

    # Output trace IDs
    ids = [t["id"] for t in sampled]
    print(f"\nTrace IDs: {ids}")

    db.close()
    return sampled


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sample traces for annotation")
    parser.add_argument("--experiment-id", type=int, required=True)
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    sample_traces(args.experiment_id, args.count, args.seed)
