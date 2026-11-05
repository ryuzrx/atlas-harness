# Contributing to Atlas Harness

Thanks for helping. Atlas Harness is a local-first macOS app (Swift shell + React UI + Python backend).

## Ground rules

- **Open an issue first** for anything bigger than a bug fix, so we can agree on the approach.
- **Keep pull requests focused.** One change per PR, with a clear description and how you tested it.
- **No mock functionality.** Features must work against real providers and the real backend.
  Test doubles belong only in `tests/`.
- **Never weaken the safety model.** That covers folder confinement, the command policy, the sandbox,
  approvals, Keychain-only secrets and localhost-only binding. Security-sensitive changes need a test.
- **Keep the design system.** Use the monochrome tokens in `apps/desktop/src/styles.css`, 8–12px
  radii, no decorative gradients or glow, and short motion that respects Reduce Motion.

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt pytest
cd apps/desktop && npm ci && cd ../..
```

## Before you open a PR

```bash
.venv/bin/python -m pytest tests            # all tests must pass
(cd apps/desktop && npm run build)          # type-checks and builds the UI
./scripts/build_macos_app.sh                # optional: build and try the real app
```

Backend code must stay compatible with Python 3.9, the version macOS ships with the Command Line Tools.

## Adding a model provider

Most providers are OpenAI-compatible. Add a preset to `backend/atlas/providers/catalog.py`:
- Verify the base URL: an unauthenticated `GET <base>/models` should return 401/403 or a model list.
- Include `key_url` (the provider's API-key page).
- Add a short, factual `note`.
- `tests/test_providers.py` checks the catalog for consistency.

For providers with a different protocol, add an adapter next to `providers/anthropic.py`.

## Commit messages

Use the imperative mood and a short subject, for example `Add Groq preset` or `Fix worktree cleanup on cancel`.
Explain the *why* in the body when it isn't obvious.

## License of contributions

By contributing, you agree that your contributions are licensed under the project's license,
**AGPL-3.0-or-later**.
