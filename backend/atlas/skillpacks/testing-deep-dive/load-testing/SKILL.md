---
name: load-testing
description: Run a meaningful load test.
---

Use this to run a meaningful load test.

## Steps
1. Set the goal: expected and peak traffic, and the targets (for example p95 under 300ms and errors under 0.1% at 500 requests per second).
2. Model realistic traffic: a mix of endpoints, think time, realistic data, and logged-in versus anonymous users.
3. Use a tool such as k6, Locust or Gatling. Test in an environment like production, never in production without approval.
4. Ramp up in stages: baseline, expected load, peak, then beyond to find the breaking point. Include a soak test for leaks.
5. Watch the server side too: CPU, memory, the database, queues and errors.
6. Report the bottleneck and test again after fixing it.

## Output
The test script, the results (latency percentiles, throughput, errors), the bottleneck, and recommendations.
