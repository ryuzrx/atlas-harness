---
name: caching-strategy
description: Decide what to cache and how.
---

Use this to decide what to cache and how.

## Steps
1. Measure first: which reads are slow or frequent, and how fresh the data must be.
2. Pick the layer: HTTP or CDN (Cache-Control, ETag), the application (Redis or in-memory), the database (query cache, materialised views).
3. Pick the pattern: read-through or cache-aside, with a TTL that matches how stale the data is allowed to be.
4. Plan invalidation: on write, by key or tag, or versioned keys. Know what happens with stale data.
5. Protect against stampedes (locks, early refresh) and design the keys carefully (include the user or tenant where needed).
6. Monitor the hit rate and latency.

## Output
What to cache, where, its TTL, its invalidation rule, and the expected effect.
