---
name: flaky-tests
description: Fix flaky tests.
---

Use this to fix tests that sometimes fail.

## Steps
1. Confirm it's flaky: run it many times in a loop, and in random order, to measure the failure rate.
2. Sort the cause: timing (sleeps, races, missing awaits), shared state (order dependence, global data, leftover files), environment (time zone, locale, clock, network), or randomness.
3. Reproduce it more often: run in parallel, under CPU stress, or with a seeded random order.
4. Fix the cause: wait for a condition instead of a fixed time, isolate data, freeze the clock, seed the randomness, mock the network.
5. Quarantine a test only for a short time, with a linked ticket. Don't just add retries.

## Output
The cause, the fix, and the loop-run result showing it's stable.
