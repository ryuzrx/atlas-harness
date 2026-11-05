---
name: performance-audit
description: Find and fix slow code with evidence.
---

Use this to find and fix slow code with evidence.

## Steps
1. Define "slow" with a number and a target (for example p95 of 800ms, aiming for 200ms) and a repeatable way to measure it.
2. Profile before changing anything: a CPU profiler, query logs, network timings or a flame graph.
3. Find the biggest cost first. It's usually I/O, N+1 queries, repeated work or large payloads, not micro-optimisations.
4. Fix one thing, measure again, and keep it only if it helps.
5. Check you haven't broken correctness or made the code much harder to read.

## Output
The baseline, the bottleneck you found (with evidence), the change, the measurement after, and what's left.
