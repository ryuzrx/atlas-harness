---
name: write-runbook
description: Write an operations runbook someone can follow at 3 a.m.
---

Use this to write a runbook someone can follow at 3 a.m.

## Steps
1. Title and trigger: which alert or symptom sends someone to this page.
2. Impact and severity: who is affected, and how to tell how bad it is.
3. Quick checks: dashboards, commands and the expected output for each.
4. Fixes in order, safest first, each with exact commands and how to confirm it worked.
5. Rollback and escalation: who to call, when, and what information to give them.
6. Links: dashboards, logs, related runbooks.

## Watch out for
- Steps that depend on knowledge the reader doesn't have. Copy-paste commands beat descriptions.

## Output
The runbook in that structure, with commands in code blocks.
