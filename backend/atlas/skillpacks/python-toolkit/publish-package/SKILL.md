---
name: publish-package
description: Publish a Python package.
---

Use this to publish a Python package to PyPI.

## Steps
1. Use a `pyproject.toml` with a build backend (hatchling, setuptools or flit). Fill in the name, version, description, readme, licence, `requires-python`, dependencies and URLs.
2. Use a `src/` layout. Include a `py.typed` file if the package is typed.
3. Build with `python -m build` and check with `twine check dist/*`.
4. Upload to TestPyPI first, install it in a fresh virtual environment, and test the import.
5. Publish with trusted publishing from CI (GitHub Actions OIDC) instead of long-lived tokens.
6. Tag the release and update the changelog.

## Output
The pyproject.toml, the build and publish commands, and an optional CI workflow.
