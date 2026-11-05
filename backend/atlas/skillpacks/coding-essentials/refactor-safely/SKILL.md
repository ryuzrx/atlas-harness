---
name: refactor-safely
description: Improve code structure without changing behaviour.
---

Use this when improving structure without changing behaviour.

## Steps
1. State the goal: what will be easier after the refactor (reading, testing, extending)?
2. Make sure tests cover the current behaviour. If they don't, add characterisation tests first that pin down what the code does today.
3. Work in small steps that each keep the tests passing: rename, extract a function, move, inline, then simplify.
4. Run the tests after every step. Commit or checkpoint often.
5. Keep refactoring separate from behaviour changes. If you find a bug, note it and fix it in its own step.
6. At the end, compare the public interface before and after. Callers shouldn't notice.

## Watch out for
- Big-bang rewrites.
- "Cleanups" that subtly change ordering, error types, default values or performance.
- Removing code that only looks unused. Search for dynamic uses: reflection, string lookups, configuration.

## Output
What changed and why, proof that behaviour is the same (the tests run), and any follow-ups you noticed.
