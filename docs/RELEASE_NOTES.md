# Release notes

## 0.5.1 — 2026-11-06

### Approvals

- "Always allow" now really stops asking: Atlas remembers the exact command you approved and runs it without a prompt next time. Blocked commands stay blocked. It's available in the chat approval card, the Dynamic Island and the menu bar.
- Auto-approve no longer asks about everyday commands that hide errors with `2>/dev/null` or write to temporary folders. Writing into system paths still asks.
- Auto-approve now also applies to Claude Code and Codex agents.

### Previews

- Runs show the images and 3D models an agent creates or changes, right in the chat, including files made by commands such as Blender exports.
- 3D models (glTF/GLB, OBJ, STL, PLY) open in a built-in viewer you can rotate and zoom, with a large view. Images open full size.
- Only image and model files from the run's own folder can be previewed.

## 0.5.0 — 2026-11-06

### Dynamic Island

- Atlas now lives in the notch (or a virtual notch on displays without one) as a Dynamic Island with a glowing orb. The orb blinks, follows the pointer and reacts to what Atlas is doing: planning, working, done, or needing you.
- While agents work, the island shows the latest step, such as the command it ran or the file it edited.
- Hover or click to open it. Ask Atlas a question right from the island and pick the model to use; replies stream in and can be opened in the main window.
- Approve, always allow, or deny commands and answer agent questions from the island or the new menu bar menu. Approving anywhere clears the request everywhere.
- Atlas reports its runs to Coucou as the agent "atlas". When Coucou or Vorssaint is running, Atlas's island leaves the notch to them and shows approvals as a card under the menu bar.
- Closing the main window keeps Atlas running for the island and menu bar; reopen it from the Dock or the menu.

### Agents and projects

- Project chats run as agents with file, terminal and Git tools, so Atlas runs commands instead of printing them.
- Auto-approve per chat: everyday commands run without asking, while deleting files, git push or reset, chmod, kill, piping downloads to a shell and publishing still ask. Blocked commands stay blocked.
- Runs show a live, Claude-style list of each command and file action with its output. The Session panel shows progress, changed files and context.
- Projects in the Work sidebar are collapsible groups with their chats, newest first. Project chats stay in Work and no longer appear in Chat history.

### Interface and fixes

- Interface size uses native page zoom, so everything scales evenly.
- Resizing the window no longer flashes grey; side panels no longer cover the chat; composer controls wrap with Send kept in place.
- Fixed the previous chat briefly showing when switching chats.
- Softer spring motion, press feedback, system reduced-motion support, and a quiet starfield on the empty Chat and Work screens in dark theme.

## 0.4.0 — 2026-11-05

### Chat access and computer use

- Chat access now offers Read only and Workspace presets. Workspace remains the default; the backend enforces the selected permission ceiling for agent and team runs.
- Atlas-managed agents can ask a question in chat and resume the same run after an answer.
- Work projects show their chats in the project list. New project chats open in the regular Chat workspace and keep the selected project attached.
- Added opt-in Atlas Computer Use for eligible models, with per-chat screen disclosure, approval before clicks/typing/key presses, macOS Screen Recording and Accessibility permissions, and a run Stop control. Custom localhost endpoints also require screen disclosure.
- Atlas can build within the selected project and inspect a local browser preview through Computer Use. Screen captures are not saved by default. Stop prevents later actions; a Mac action already in progress may finish.
- Models known to lack image or tool support are blocked. Models whose capabilities are unknown can be tried after confirmation; the backend still rejects models that explicitly report they cannot handle the request. Team and CLI modes are not available for Computer Use in this version.

## 0.3.4 — 2026-11-05

### Projects and models

- Work starts with a local folder, with Git repository cloning available as an alternative. Project sessions use a chat-style composer; Git checkouts remain on this Mac.
- Welcome can connect OpenRouter's free-model router. Setup explains rate limits and that prompts go to OpenRouter and its selected provider.
- Corrected the macOS executable target so it matches the advertised macOS 13 minimum.

### Claude Code and Codex

- Both continue to use their own installed CLI and sign-in. Atlas selects the available CLI model but does not alter subscription limits.

## 0.3.3 — 2026-11-05

### Interface

- A collapsible icon sidebar with persistent state and profile access in either layout.
- Personalized setup with name, photo, workspace label, and welcome-greeting controls.
- An animated launch sequence that opens the workspace automatically, with an Appearance setting and reduced-motion support.
- Refreshed model, team, agent, and profile management, with clearer spacing and theme contrast.
- A chat model picker with provider groups, descriptions, selected states, and exact model IDs.
- Codex model discovery from its local catalog; only selectable model metadata is exposed.

### Reliability

- Fixed team suggestion errors and automatic model assignment during team creation.
- Cancelled obsolete page requests so late responses cannot overwrite newer results.
- Recover safely from invalid saved navigation state.
- Shut down background health checks and download tasks cleanly, including CLI subprocess cleanup.

### Repository

- Updated documentation and screenshots using fictional demo data.
- Excluded local plans, browser recordings, and database files from version control.


## 0.3.2 — 2026-11-05 (chat attachments and team routing)

### New
* **Download tray.** Track model downloads from any screen, see progress, stop a download, and retry
  after an error.
* **Chat attachments.** Attach text files from the file picker or drag and drop; paste or pick images
  for vision-capable models.
* **Role-based team models.** Template teams choose a suitable connected model for each agent tier, and
  existing teams can fill missing assignments from their endpoints.

### Fixed
* **Ollama downloads.** Atlas starts its managed local Ollama service when needed and reports registry
  connection failures with clearer guidance.
* **Teams and forms.** Suggested teams no longer inherit the model from your last chat. The team Agents
  tab is reduced to agent, role, model and status. Modal inputs keep focus while typing.
* **Desktop file picker.** The composer’s plus button opens the native macOS file chooser.
* **Theme contrast.** Model names and hints stay readable in both Light and Dark themes.

## 0.3.1 — 2026-11-05 (refined Mac look)

### Changed
* **One design system.** One set of corner sizes and one set of text sizes across the whole app,
  instead of dozens of hand-picked values.
* **Neutral macOS colours.** Greys in the style of #1d1d1f and #f5f5f7, softer shadows and a neutral
  focus ring. No blue tint is left in Dark.
* **Rebuilt controls.** Buttons, inputs, Mac-style switches, tabs, segmented controls, menus, modals
  and toasts are rebuilt on the new design system.
* **Sidebar.** Compact rows, small section labels, a slim Chat/Work switch and a lighter profile row.
* **Chat.** A calmer home with one heading and starter suggestions, and a composer toolbar with
  pill-style buttons.
* **Work.** A titled "New session" screen with a grouped folder picker.
* **Settings** looks like System Settings, with rounded groups of rows.

### Fixed
* The Ollama, Apple and xAI logos were nearly invisible in Light mode.
* Provider rows on the Models page no longer cut names short in narrow windows.

## 0.3.0 — 2026-11-04 (Atlas: Chat and Work, skills, extensions)

### New
* **Renamed to Atlas.** The app bundle, menus and window title now say Atlas. Your existing data
  folder is kept, so chats and keys carry over.
* **Chat and Work.** A switch under the wordmark changes the sidebar between chat history and project
  folders. Work opens a "New session" screen: pick a project, continue uncommitted work, and type.
* **Session panel** beside a chat shows the environment, context used, connectors and git changes.
* **Skills.**
  * 26 built-in skill packs with 125 step-by-step skills, covering coding, git, research, writing,
    design, product, data, security, DevOps, web, Python, JS/TS, mobile, APIs, AI and prompting,
    business, careers, docs, games (including Roblox Luau), fiction, finance, support, testing,
    shell and maths.
  * Type `/` in the composer to pick a skill.
  * A GitHub finder lists open-source skills (open-source licences only).
  * You can write your own skill or add one from a folder.
* **Plugins and hooks.** Add plugins with an on/off switch. Hooks run your own commands before or
  after a tool. Hooks are off until you turn them on.
* **Integrations.** Connect an integration in one step, from a gallery of popular ones, with plain
  questions instead of raw config.
* **Import.** Finds the project folders and skills you already use with Claude Code, Codex, OpenCode,
  Cursor and VS Code.
* **Models.**
  * A Download models window with categories, company logos and a folder picker for where models are saved.
  * **Find the best model for me** reads your Mac's memory and recommends a model after two questions.
  * Provider logos in colour, a rebuilt chat model picker, and plain-language connection errors.
* **Teams and agents.**
  * Teams and agents are now shown as card grids.
  * Teams have a **Help me choose** button, where a model (or keyword matching, if no model is
    connected) suggests preset teams.
  * Runs have simpler controls.
* **Settings** is now a searchable popup with grouped sections. New options include the default
  abilities for new agents, the default team template, confirm-before-delete, the launch view, text
  size, notifications, settings export and import, and a profile (name, photo, workspace label).
* **Welcome** now has steps to personalise Atlas, set up teams and add skills.
* **Themes:** Light and Dark only. Dark is pure black and white.

### Fixed
* The legal documents render bold text and links correctly.
* The welcome summary shows the teams and skills you actually added.
* Overlapping menus paint above the rows below them.

## 0.2.0 — 2026-11-04 (chat-first, open source)

### New
* **Chat-first interface.** The app opens on a conversation. Pure-black monochrome design and a new
  angular "A" monogram, used in the app and the app icon.
* **Persistent conversations** (schema v2): grouped by day, searchable, renamable and deletable.
  Replies stream token by token. Text-file attachments and deep links (`#/chat/<id>`) are supported.
* **Composer:**
  * The Agent menu chooses no agent, one agent or a team.
  * The Model menu lists every model with live provider status.
  * The Tools menu sets the project, project context, read, edit, terminal, git, memory and MCP access.
  * A model given tools runs as the sandboxed **Atlas Assistant** agent. For an agent, the selected
    tools can only narrow its permissions (`tasks.config.tool_limit`).
* **Run panels in chat:** sub-runs, live events, inline approvals and a stop button. The result becomes the reply.
* **34 provider presets**, 25 of them cloud APIs. Every endpoint URL was checked. Each preset has a
  link to the provider's key page. Custom headers and fixed model lists are supported. Base URLs that
  have a path are used exactly as given.
* **Model library:** 49 Ollama models checked against the registry, including abliterated builds, plus
  any tag or Hugging Face GGUF.
* **Motion:** a sliding navigation highlight, a staggered welcome screen, messages that rise in, menus
  that open from their trigger and smooth disclosure panels. All of it is disabled by Reduce Motion.
* **Other:** a display name setting, links that open in the default browser, and a fix for a monitor
  crash when macOS denies process memory info.
* **Open source** under AGPL-3.0-or-later, with CI, contributor and security docs.


## 0.1.0 — 2026-11-04 (first vertical slice)

### Included
* Native macOS app (Swift shell + WKWebView) with a bundled Python backend; installs to `~/Applications`
  without admin rights.
* Providers: Ollama (with user-local install, start/stop, pull, unload, delete), OpenAI-compatible
  servers (MLX-LM, llama.cpp, LM Studio, vLLM, OpenRouter, OpenAI incl. Codex models), Anthropic Claude
  API, Claude Code CLI, Codex CLI (cloud or `--oss` with a local model).
* Per-model capability probing with real requests; text tool protocol for models without tool calling
  (abliterated and community models).
* Teams from five templates, custom agents, presets, cloning, moving between teams, team lead.
* Objective planning by the lead, task DAG with validation, dependency-aware parallel scheduling, shared
  per-provider inference queue, approvals, cancellation, bounded retries, review/verification task,
  final report, structured agent messages.
* Git worktree isolation, diff viewer, merge preview, protected-branch confirmation, revert.
* Team/project memory with verification flags; context compaction to per-agent budgets.
* Live execution viewer, kanban, dependency graph, approval queue, model manager, system monitor,
  audit log, settings, command palette, keyboard shortcuts, light/dark themes.

### Known limitations
* **Python 3.9 dependency.** The backend runs on the macOS Command Line Tools Python. OpenHands SDK,
  LangGraph and LiteLLM were therefore not adopted (they need ≥ 3.10/3.12).
* **Codex CLI not exercised end-to-end here.** Its flags were verified against `codex-cli 0.166.0`
  (`exec --json --cd --sandbox --skip-git-repo-check --ephemeral --oss --local-provider`), but no Codex
  sign-in was available in the test environment, so no Codex task was run.
* **Claude API / OpenAI API** adapters were not exercised against live keys (none configured). Claude
  Code was exercised live.
* **Pause** takes effect between tasks; an in-flight model request is not interrupted (use Cancel).
* **CLI agents** (Claude Code, Codex) apply their own permission systems; ATLAS restricts their tools
  and working directory but cannot show per-command approval prompts for them.
* **Small local models** (≈7B) follow the tool protocol but often struggle with multi-step plans; the
  loop guard and step limit stop runaway agents. Larger models give much better results.
* Unsigned (ad-hoc) build: fine for your own Mac; distributing to others needs a Developer ID.
* Windows/Linux shells are not implemented (the backend and UI are portable).
* No vector index yet; retrieval is search + targeted file reads.
