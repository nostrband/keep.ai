#!/usr/bin/env python3
"""Find review files that have unhandled issues."""

import os
import re
import glob

BASE = "/home/artur/keep.ai"
DIRS = ["reviews", "ux-tests"]

results = []

for d in DIRS:
    pattern = os.path.join(BASE, d, "*.txt")
    for filepath in glob.glob(pattern):
        mtime = os.path.getmtime(filepath)
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        lines = content.splitlines()

        # Find the LAST "ISSUE REVIEW" heading (the actual review section, not body text references)
        issue_review_idx = None
        for i, line in enumerate(lines):
            stripped = line.strip().strip("=").strip()
            if stripped.upper() == "ISSUE REVIEW":
                issue_review_idx = i

        if issue_review_idx is None:
            results.append((mtime, filepath, "MISSING ISSUE REVIEW section"))
            continue

        # Check for pending issues: lines starting with "- Issue" that end with "- pending"
        pending_count = 0
        review_lines = lines[issue_review_idx:]
        for line in review_lines:
            line_stripped = line.strip()
            if line_stripped.startswith("- Issue") and re.search(r'-\s*pending\s*$', line_stripped):
                pending_count += 1

        if pending_count > 0:
            results.append((mtime, filepath, f"has {pending_count} PENDING issue(s)"))

# Sort by modification time, newest first
results.sort(key=lambda x: x[0], reverse=True)

if not results:
    print("All review files are fully handled!")
else:
    print(f"Found {len(results)} file(s) needing attention:\n")
    for mtime, filepath, reason in results:
        rel = os.path.relpath(filepath, BASE)
        from datetime import datetime
        ts = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        print(f"  {ts}  {rel:<35s}  {reason}")
