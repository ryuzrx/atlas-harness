---
name: clean-data
description: Clean messy data safely.
---

Use this to clean messy data without losing information.

## Steps
1. Keep the raw data untouched. Write every change as a repeatable step (a script, not manual edits).
2. Standardise: trim whitespace, consistent case, dates in ISO format, a single unit, and numbers stored as numbers.
3. Deal with missing values deliberately: drop, fill, or flag. Write down why.
4. Remove exact duplicates. Review near-duplicates rather than merging them automatically.
5. Check for outliers: fix them if they're clear errors, keep and flag them otherwise.
6. Validate at the end: row counts before and after, totals, and spot checks.

## Output
The cleaned data, the script, and a change log (step, rows affected, reason).
