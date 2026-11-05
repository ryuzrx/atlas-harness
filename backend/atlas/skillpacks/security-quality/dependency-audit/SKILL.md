---
name: dependency-audit
description: Check dependencies for risk and bloat.
---

Use this to check a project's dependencies for risk and bloat.

## Steps
1. List the direct and transitive dependencies from the lockfile.
2. Run the ecosystem's audit tool (npm audit, pip-audit, cargo audit, osv-scanner) and confirm which findings are actually reachable.
3. Check health: last release, maintainers, open security issues, downloads, and whether it's deprecated.
4. Check licences against the project's licence and policy.
5. Look for bloat: duplicate versions, heavy packages used for one function, and unused dependencies.
6. Recommend upgrades, replacements or removals, ordered by risk and effort.

## Output
A table (package, issue, severity, recommended action) plus the exact upgrade commands.
