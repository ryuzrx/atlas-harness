---
name: migration-plan
description: Plan a safe data or schema migration.
---

Use this to plan a safe data or schema migration.

## Steps
1. Describe the current state and the target state. Estimate the data volume and how long it will take.
2. Use expand and contract: add the new structure first (backward compatible), write to both, backfill in batches, switch reads, then remove the old structure.
3. Make every step reversible, or take a tested backup first.
4. Avoid long locks: create indexes concurrently, backfill in batches, and run outside peak hours.
5. Validate with row counts, checksums and spot checks before switching over.
6. Write down the rollback plan and who decides to use it.

## Output
A step-by-step plan with commands or SQL, checks and rollback for each step.
