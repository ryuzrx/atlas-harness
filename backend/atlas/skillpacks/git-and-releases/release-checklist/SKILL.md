---
name: release-checklist
description: Walk through a safe release.
---

Use this to walk through shipping a version safely.

## Steps
1. Freeze scope: confirm what's in the release and that the main branch is green.
2. Bump the version following the project's scheme (semver: major for breaking, minor for features, patch for fixes).
3. Update the changelog and any version strings or docs.
4. Run the full test suite, build the release artifacts, and smoke-test the artifact itself, not just the source.
5. Check migrations, config changes and feature flags. Confirm there's a rollback plan.
6. Tag the commit, publish, and verify that the published package or deploy works.
7. Announce it: release notes and who needs to know. Watch errors and metrics for a while afterwards.

## Watch out for
- Releasing from a dirty working tree, or from a commit that CI didn't test.
- Skipping the rollback plan because "it's small".

## Output
A checklist with each item checked off or flagged, and any blockers listed at the top.
