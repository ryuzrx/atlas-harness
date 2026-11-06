# Verification

## Current source checks — 2026-11-05

- **52 backend checks pass** on Python 3.9 with the pinned dependencies, with no warnings in the final run.
- The desktop TypeScript check and production UI build pass.
- The macOS app bundle builds, imports its backend, and installs successfully.
- Demo browser checks cover automatic startup, reduced motion, persistent sidebar collapse, model selection, personalization save ordering, and recovery from corrupted saved navigation.
- Public screenshots use an isolated database with fictional teams and a demo profile. Home-folder paths are abbreviated.

These checks do not establish compatibility with every external provider or model. No paid inference was used in this pass. The live-model observations below are historical results from an earlier source revision.

## Historical verification report — 2026-11-04

Environment: Apple Silicon Mac, macOS, Python 3.9 (Command Line Tools), standard (non-admin) user.
Models used: `qwen2.5-coder:7b` (Q4_K_M) on Ollama 0.40.14, installed by ATLAS into its own data folder;
Claude Code 2.1.314 with model alias `haiku`.

## Automated tests (`pytest tests`) — 20 passed

Deterministic tests use a scripted provider (test-only) through the real HTTP API, orchestrator,
tools, git and SQLite:
auth required · team planning → delegation → implementation → review · worktree isolation and merge
into protected branch (refused without confirmation) · revert · parallel tasks overlap in time in separate
worktrees · shared-file conflict detection · command approval + denial · agent path escape (absolute,
`../`, symlink) blocked · credential and `.git` files blocked · `sandbox-exec` blocks writes outside the
workspace · restart recovery (interrupted task → failed, settings/teams persist, retry works) · provider
connection failure → task failed, API responsive · dependency cycle rejected · blocked-dependency
propagation · CLI env key stripping · tool-call parsing (fenced, bare, flattened, string args) · context
compaction · empty `edit_file` rejection.

## Live acceptance tests (`scripts/acceptance.py`, real models)

| # | Test | Ollama qwen2.5-coder:7b | Claude Code (haiku) | Evidence |
|---|---|---|---|---|
| 1 | Local inference | **PASS** | — | Real `/api/chat` reply; 1.2 s cold, 0.1 s warm; token counts measured by Ollama. |
| 2 | Coding task | **PASS** | **PASS** | Both read `mathutils.py`, fixed `a - b` → `a + b` on `atlas/<task>` branch; user checkout untouched. Local model's `pip install pytest` was held for approval and denied. |
| 3 | Team coordination | **FAIL** (model) | **PASS** | Claude: lead planned, engineer implemented, auto-added reviewer verified, completion + handoff messages. 7B: plan of 4 tasks + delegation worked; engineer hit the 25-step limit (overwrote the file), dependents correctly blocked, objective reported failed. |
| 4 | Parallel execution | **PASS** | — | Two tasks overlapped in time in separate worktrees; inference limit 2/provider. |
| 5 | Persistence | **PASS** | | Backend restarted mid-run: teams, settings, history intact; in-flight tasks marked failed "interrupted by restart"; blocked work propagated; no tool calls replayed. |
| 6 | Provider failure | **PASS** | | Ollama stopped mid-task → task failed "Ollama connection failed…", provider status failed, `/health` answered in < 10 ms. |
| 7 | Security | **PASS** (unit + live) | | Live 7B agent did not attempt the escape (weak evidence); deterministic tests prove absolute, `../` and symlink reads are denied. |
| 8 | Git safety | **PASS** | | User's uncommitted README edit preserved; merge previews clean; target `main` flagged protected. |
| 9 | Interface | **PASS (manual)** | | Every screen opened in the preview browser against the live backend: Overview, Teams (cards/list, create modal), Team detail tabs, Agents, Tasks (list, board, dependency graph, approvals), Projects, Models, Activity, Settings, inspector, palette. |
| 10 | Performance | measured | | Idle (installed app, 30 s): CPU 0.0–0.1 %; RSS shell 92 MB, backend 68 MB, WebKit content ~53 MB. |

Codex CLI: flags verified against `codex-cli 0.166.0`; **not run end-to-end** (no Codex sign-in in the test environment).
Claude API / OpenAI API adapters: **not run** (no keys configured).

## Defects found by live testing and fixed

1. WebSocket library missing → added `websockets`.
2. UI "Reconnecting" banner race → state synced on subscribe.
3. Probe results ignored for Ollama → verified probe now overrides template claims.
4. Models writing tool JSON without fences / flattened / stringified args → parser handles all.
5. Small models looping → repeated-response guard.
6. A task depending on a *blocked* task stayed queued forever → blocked propagates.
7. Claude Code asked for in-place approval despite having a worktree (stale record) → re-read from DB.
8. Inherited `ANTHROPIC_API_KEY` overrode the Claude sign-in → CLI agents strip inherited keys by default (opt-in setting).
9. **`edit_file` with empty `old_text` + `replace_all` grew a file to 3.3 GB and hung the backend** →
   empty `old_text` rejected, 5 MB write cap, command output capped at 2 MB, event payloads capped at 64 KB,
   git work moved off the event loop.

## Bottlenecks observed

* 7B local models: 1–15 s per step; multi-step team objectives frequently exceed the step limit.
  Use larger local models (e.g. 14B–32B) or route the lead/reviewer tier to a stronger model.
* Planning with a local model is a single long JSON generation; it blocks one inference slot.

## Chat-first UI (2026-11-04, later the same day)

Automated: `tests/test_chat.py` covers model chat, history, attachments, search, rename, delete, restart
persistence, and a tool-limited agent turn (the write tool is unavailable and the file is unchanged).

Live, against Ollama `qwen2.5-coder:7b` in the preview browser:
* A streamed reply grew in steps (48 → 74 → 100 → 109 characters at 250 ms samples) and rendered as Markdown with a code block.
* The conversation was auto-titled, listed under Today, and restored after a reload.
* Model + Read files ran as Atlas Assistant (`tool_limit: ["read"]`). It called `list_dir` and `finish`, and the
  result was copied into the chat. The 7B model's summary named files that do not exist (the folder was empty):
  this is a model-quality limit.
* Team mode created an objective for the selected team (planning). **Stop** cancelled it, and the message shows as stopped.
* Layout was checked at 1671×941, 1440×900 and 900×700, with the sidebar expanded and collapsed.

Not verified: the native window itself (no screen-recording permission) and Codex.
