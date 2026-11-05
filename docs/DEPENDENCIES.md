# Dependency and license inventory

Atlas Harness itself is licensed under **AGPL-3.0-or-later** (see `LICENSE`). Every dependency below uses a
permissive license (MIT, BSD or Apache-2.0) that is compatible with the AGPL.

Versions are exact as installed in the build on 2026-11-04. Licenses were read from installed package
metadata (Python) and `package.json` (JavaScript).

## Bundled in the app

### Python (vendored into `Contents/Resources/pylib`)
| Package | Version | License |
|---|---|---|
| fastapi | 0.115.14 | MIT |
| starlette | 0.46.2 | BSD-3-Clause |
| uvicorn | 0.32.1 | BSD-3-Clause |
| websockets | 13.1 | BSD-3-Clause |
| httpx | 0.27.2 | BSD-3-Clause |
| httpcore | 1.0.9 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| anyio | 4.12.1 | MIT |
| sniffio | 1.3.1 | MIT OR Apache-2.0 |
| idna | 3.20 | BSD-3-Clause |
| certifi | 2026.10.23 | MPL-2.0 |
| pydantic | 2.9.2 | MIT |
| pydantic_core | 2.23.4 | MIT |
| annotated-types | 0.7.0 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| click | 8.1.8 | BSD-3-Clause |
| psutil | 6.1.1 | BSD-3-Clause |

### JavaScript (compiled into `Contents/Resources/ui`)
| Package | Version | License |
|---|---|---|
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| lucide-react | 1.68.0 | ISC |

### Build-time only
| Package | Version | License |
|---|---|---|
| vite | 8.3.5 | MIT |
| @vitejs/plugin-react | 6.2.1 | MIT |
| tailwindcss / @tailwindcss/vite | 4.3.4 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| pytest (tests) | 8.4.2 | MIT |
| Node.js (local toolchain, `.tools/`) | 26.13.0 | MIT |

## External software ATLAS integrates with (not bundled)

| Project | Use | License (GitHub, checked 2026-11-04) |
|---|---|---|
| Ollama | Primary local provider; optional user-local install from GitHub releases | MIT |
| MLX-LM | OpenAI-compatible server (`mlx_lm.server`) | MIT |
| llama.cpp | OpenAI-compatible server (`llama-server`) | MIT |
| Claude Code | Supervised CLI agent runtime (`claude -p`) | Anthropic terms |
| OpenAI Codex CLI | Supervised CLI agent runtime (`codex exec`) | Apache-2.0 |
| MCP servers | Optional stdio tool servers configured by the user | per server (repo: NOASSERTION) |

## Evaluated, not adopted

| Project | Finding | Decision |
|---|---|---|
| OpenHands Software Agent SDK (MIT) | `openhands-sdk` 1.59.0 requires Python ≥ 3.12 | Not usable on the target (Python 3.9, no admin). Event/tool design informed ATLAS's event model. |
| OpenHands (MIT) | Full platform, Docker-oriented runtime | Too heavy for a compact local app. |
| OpenHarness (MIT) | Multi-session + git worktree pattern | Pattern adopted (worktree per task), code not used. |
| Continue (Apache-2.0) | IDE-centric context providers | UX reference only. |
| LangGraph (MIT) | 1.2.19 requires Python ≥ 3.10 | Durable state implemented on SQLite instead. |
| LiteLLM (NOASSERTION on GitHub; mixed licensing) | 1.108.0 requires Python ≥ 3.10 | Thin native provider adapters instead. |
