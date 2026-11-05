---
name: python-project-setup
description: Start a Python project the modern way.
---

Use this to start a Python project the modern way.

## Steps
1. Use a project tool (uv, or Poetry or Hatch if the team prefers). Pin the Python version.
2. Use one `pyproject.toml` for metadata, dependencies and tool settings, with a `src/<package>/` layout.
3. Add Ruff (lint and format), a type checker (mypy or pyright) and pytest.
4. Commit the lockfile. Keep dev dependencies separate.
5. Add a pre-commit config and CI that runs lint, types and tests.
6. Write a README with setup and run commands.

## Output
The folder tree, pyproject.toml, config files, and the commands to get started.
