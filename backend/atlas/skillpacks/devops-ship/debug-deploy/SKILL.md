---
name: debug-deploy
description: Diagnose a failed deploy.
---

Use this when a deploy fails or the app breaks after one.

## Steps
1. Decide right away whether to roll back. If users are affected and a rollback is safe, do it first and investigate after.
2. Pin down what changed: the code diff, config, environment variables, infrastructure and dependency versions.
3. Read the build and deploy logs from the first error. Then check runtime logs and health checks.
4. Check the usual suspects: missing environment variables or secrets, failed migrations, wrong ports or health-check paths, out-of-memory, and image architecture mismatch.
5. Reproduce in staging, or locally with the production config, if you can.
6. Fix it and redeploy. Add a check or alert so it's caught earlier next time.

## Output
The impact, the cause, the fix, and the prevention step.
