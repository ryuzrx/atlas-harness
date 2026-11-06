# Atlas architecture

## Process model

```
Atlas.app
├── Contents/MacOS/Atlas      Swift shell (AppKit + WKWebView, ~200 KB)
│     • generates a 256-bit per-launch token
│     • starts the backend:  /usr/bin/python3 -m atlas.main  (PYTHONPATH = bundled backend + pylib)
│     • waits for "ATLAS_READY <port>" on stdout, loads http://127.0.0.1:<port>/#token=…
│     • native bridge: folder picker, notifications, Finder reveal, window drag, JS dialogs
│     • terminates the backend on quit
└── Contents/Resources
      ├── backend/atlas/   Python backend (FastAPI + SQLite)
      ├── pylib/           vendored Python packages (pip --target)
      └── ui/              built React app (static files served by the backend)
```

One backend process holds every layer. There are no extra services (no Redis, no broker, no separate
orchestrator process). Model servers (Ollama, MLX-LM, llama.cpp) are external processes that ATLAS
connects to; Ollama can be installed and started by ATLAS into the user's folder.

## Layers (backend/atlas)

| Layer | Module | Responsibility |
|---|---|---|
| Application API | `api.py` | Typed REST + WebSocket. Binds to 127.0.0.1 only. Rejects other `Host` headers (DNS rebinding) and requests without the launch token. |
| Orchestration | `orchestrator.py` | Objective → plan → task DAG; validated state machine; dependency-aware, resource-aware scheduler; approvals; cancellation propagation; bounded retries; verification task; final report; merges/rollback; crash recovery. |
| Agent runtime | `agent.py` | Context assembly + compaction, model call, tool loop. Native tool calling where verified, otherwise a fenced-JSON text protocol (works with any model, including abliterated builds). Loop guard. |
| CLI agent runtimes | `providers/cli_agents.py` | Claude Code (`claude -p --output-format stream-json`) and Codex (`codex exec --json`). ATLAS picks the cwd (isolated worktree), maps permissions to each CLI's own permission system, streams their events, and computes diffs itself. |
| Model router | `providers/__init__.py` | Provider registry, per-provider inference semaphore (shared queue: many agents, one loaded model), bounded retry with backoff, health, capability probing, Ollama install/start/stop. |
| Providers | `providers/*.py` | Ollama (`/api/chat`, `/api/show` capabilities, `/api/ps`), OpenAI-compatible (MLX-LM, llama.cpp, LM Studio, vLLM, OpenRouter, OpenAI incl. Codex models), Anthropic Messages API. |
| Tools | `tools.py` | list_dir, read_file, search, write_file, edit_file, apply_patch, run_command, git, remember, send_message, mcp, finish. Every call is an event. |
| Security | `security.py` | Workspace path resolution (symlink-safe), credential-file blocking, command classification (deny / ask / allow), `sandbox-exec` write confinement, scrubbed env, Keychain secrets. |
| Workspaces / Git | `gitops.py` | Repo detection, worktrees under `~/Library/Application Support/ATLAS Harness/worktrees`, diffs, `merge-tree` conflict preview, protected-branch guard, non-destructive revert. |
| MCP | `mcp.py` | Minimal stdio JSON-RPC client (initialize, tools/list, tools/call); lazy start; every call needs approval. |
| Persistence | `db.py` | SQLite (WAL) with forward-only migrations (`PRAGMA user_version`). |
| Events | `events.py` | Persist + fan out execution events; bounded retention; slow clients drop rather than block agents. |
| Monitoring | `monitor.py` | psutil CPU/memory, model-server RSS, Ollama loaded models. All labelled measured; token counts labelled estimated. |

## Task lifecycle

```
queued → planning → running → reviewing → completed          (objectives)
queued → ready → running → completed | failed | blocked      (subtasks)
any active state ⇄ waiting_approval;  any → cancelled;  failed/cancelled/blocked → queued (retry)
```
Transitions are validated against `TRANSITIONS` and written to `task_transitions` before the UI is told.

## Isolation and merging

* Each writing task in a git project gets branch `atlas/<task>` in its own worktree, created from the
  objective's base commit. The user's checkout is never written by agents.
* Downstream tasks start from their dependencies' branches (merged into their own worktree), so a review
  task holds the integrated result; conflicts are reported as `conflict_detected` events.
* After an objective, branches that touched the same files are reported as potential conflicts.
* Merging is always a user action: `merge-tree` preview, refusal if uncommitted user changes touch the
  same files, explicit confirmation for protected branches, `--no-ff` merge, and revert via a new commit.
* Non-git folders: writing tasks are serialized per folder (no parallel writers).

## Memory

* Agent memory: the task conversation, compacted to the agent's context budget (older tool output first).
* Team memory / project memory: `memory` table; agents write unverified notes via `remember`; users add,
  edit, verify or delete in Team → Resources. Prompts label unverified items.
* Handoffs carry summaries, changed files and branch names — never full transcripts.

## Decisions (ADR summary)

1. **An owned agent loop for Python 3.9 compatibility.** The backend supports the Python version provided by the macOS Command Line Tools. A small loop avoids a second orchestration runtime. Claude Code and Codex are integrated as supervised external runtimes.
2. **SQLite state machine instead of LangGraph.** Durable state, checkpoints and interrupts (approvals)
   are implemented directly on SQLite; no extra dependency.
3. **Swift/WKWebView shell instead of Tauri.** Building needs no Rust toolchain or admin rights:
   the Swift shell needs only Xcode CLT, adds ~200 KB, and provides native vibrancy,
   sheets and notifications. The UI is plain React, so a Tauri shell can be added later unchanged.
4. **Text tool protocol fallback.** Tool calling is verified per model by a real probe (`/probe`), and
   Ollama's template capabilities are used when no probe exists. Models without verified support use a
   fenced JSON protocol, so abliterated / uncensored community models work as agents.

## Chat-first front door (schema v2)

The app opens into **Chat**. `atlas/chat.py` (`ChatService`) stores `conversations` and `chat_messages`
(migration v2, which also adds `tasks.config`). The composer chooses how a message is answered:

| Composer | What runs | Notes |
|---|---|---|
| Model, no agent tools | `ModelRouter.chat(..., on_token=...)` | Tokens are broadcast as `chat_delta` WebSocket messages and saved every 2 s and at the end. |
| Model + Read/Edit/Terminal/Git/Memory/MCP | A task for the per-model **Atlas Assistant** agent | Same sandbox, command policy and approvals as any agent. |
| Agent | A task for that agent | Tools selected in the composer become `tasks.config.tool_limit`, which can only narrow the agent's permissions. |
| Team | A team objective | The lead plans and delegates; sub-runs show in the chat's run panel. |

Agent and team replies link to their task. The UI renders a collapsible run panel (sub-runs, live
events, inline approvals). The final result is copied into the message when the task ends.
"Project context" adds the project's top-level listing and README to model chats. Streaming
messages that were interrupted by a restart are marked as errors; running agent turns are re-watched.
