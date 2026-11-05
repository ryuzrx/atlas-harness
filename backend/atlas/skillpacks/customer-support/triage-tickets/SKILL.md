---
name: triage-tickets
description: Sort support tickets by urgency.
---

Use this to sort support tickets by urgency.

## Steps
1. Define the levels: P1 (outage, data loss, security, many users blocked), P2 (a major feature broken for some users, with no workaround), P3 (a bug with a workaround), P4 (a question or feature request).
2. For each ticket, note the impact, how many users, whether there's a workaround, whether it's a key customer, and any SLA.
3. Group duplicates and link them to one issue.
4. Route each to the right team, with a one-line summary.
5. Flag anything that needs escalating right away.

## Output
A table (ticket, priority, reason, owner, action), with P1s listed first.
