---
name: log-analysis
description: Find the problem in logs.
---

Use this to find the problem in logs.

## Steps
1. Narrow the time window around the incident and the component involved.
2. Find the first error, not the loudest one. Filter by level and request ID or trace ID.
3. Useful commands: `grep -n`, `rg`, `awk`, `sort | uniq -c | sort -rn` for counts, `jq` for JSON logs, and `journalctl -u <svc> --since`.
4. Follow one request across services by its ID.
5. Compare with a normal period: what's new or different?
6. Link the errors to deploys, config changes or traffic spikes.

## Output
A timeline of the key log lines, the likely cause, and the commands you used.
