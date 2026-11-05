---
name: debug-systematically
description: Find the root cause of a bug instead of guessing.
---

Use this when something is broken and the cause isn't obvious.

## Steps
1. Write down the symptom exactly: the error text, the expected result and the actual result.
2. Reproduce it. Find the smallest input or the fewest steps that trigger it. If you can't reproduce it, gather logs and versions before you change anything.
3. Find the last known good state (a commit, a version, a config). Bisect if there are many changes in between.
4. Form one hypothesis at a time and pick a check that could prove it wrong: a log line, a breakpoint, a print or a tiny test.
5. Narrow down by halves: confirm the data is right at the input, then the middle, then the output.
6. Once you've found the cause, explain why it produces the exact symptom. If it doesn't explain everything, keep going.
7. Fix the cause, not the symptom, and add a test that failed before the fix.

## Watch out for
- Changing several things at once. You won't know which one mattered.
- Trusting assumptions about what a value "must" be. Print it.
- Stale caches, builds or environment variables. Rule them out early.

## Output
The root cause in one or two sentences, the evidence for it, the fix, and the regression test.
