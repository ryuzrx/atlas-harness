---
name: ci-pipeline
description: Set up a continuous integration pipeline.
---

Use this to set up continuous integration.

## Steps
1. Decide what runs on every push: install, lint, type check, test and build. Add a security scan if needed.
2. Use the project's existing platform (GitHub Actions, GitLab CI, …). Pin action and tool versions.
3. Cache dependencies by lockfile hash. Run independent jobs in parallel.
4. Fail fast: cheap checks first. Make the logs readable.
5. Keep secrets in the platform's secret store, scoped to the jobs that need them. Never print them.
6. Protect the main branch: require the CI checks before merging.

## Output
The pipeline config file, an explanation of each job, and how to run the same checks locally.
