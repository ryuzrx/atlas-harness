---
name: fix-build-errors
description: Get a failing build or install working again.
---

Use this when a build, compile, install or test run fails.

## Steps
1. Read the first error, not the last. Later errors are often consequences of the first.
2. Copy the exact message and the file and line. Note the tool and version (compiler, Node, Python, package manager).
3. Sort the error into a type: syntax or type error, missing dependency, version mismatch, environment (path, permissions, missing tool) or configuration.
4. Check what changed recently: the lockfile, the tool version, the branch, the environment variables.
5. Apply the smallest fix and rebuild. Repeat until it's clean.
6. If dependencies are involved, prefer fixing the version over deleting lockfiles. Clear caches only as a deliberate step, and say that you did.

## Watch out for
- Silencing errors (`any`, `# type: ignore`, `--force`, `--legacy-peer-deps`) without explaining the trade-off.
- Upgrading many packages at once to make one error go away.

## Output
The cause, the change you made, and the command that now passes. If anything was left unresolved, list it.
