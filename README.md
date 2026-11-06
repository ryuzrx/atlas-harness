<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/atlas-mark-white.svg">
    <img src="docs/images/atlas-mark-black.svg" width="72" alt="Atlas">
  </picture>
</p>

<h1 align="center">Atlas</h1>
<p align="center"><strong>Your models. Your workspace.</strong><br>Chat, build, and work with teams of AI agents in a macOS app.</p>

<p align="center">
  <a href="https://github.com/ryuzrx/atlas-harness/releases"><img src="https://img.shields.io/badge/macOS-13%2B-222222" alt="macOS 13 or newer"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-222222" alt="AGPL-3.0-or-later"></a>
  <a href="https://github.com/ryuzrx/atlas-harness/actions/workflows/ci.yml"><img src="https://github.com/ryuzrx/atlas-harness/actions/workflows/ci.yml/badge.svg" alt="Build and tests"></a>
</p>

<p align="center"><a href="https://github.com/ryuzrx/atlas-harness/releases/latest">Download for macOS</a> &nbsp; · &nbsp; <a href="#build-from-source">Build from source</a> &nbsp; · &nbsp; <a href="docs/ARCHITECTURE.md">Architecture</a></p>

![Atlas Models workspace with local endpoints and the model library](docs/images/models-workspace.png)
<p align="center"><sub>Atlas with fictional demo data. Screenshots contain no personal accounts, conversations, or project files.</sub></p>

## One workspace, from a question to a project

| Chat | Models | Teams | Work |
| --- | --- | --- | --- |
| Stream replies, attach files, and choose the tools a conversation can use. | Connect endpoints, browse local models, and manage downloads in one place. | Start from a template, choose models by role, and follow each agent's work. | Give agents a project folder, review their changes, and approve actions that need permission. |

- **Local models and optional cloud connections.** Use Ollama, MLX, llama.cpp, LM Studio, compatible servers, or cloud providers with your own credentials.
- **Claude Code and Codex.** Use their existing sign-in. The chat picker shows readable model names and descriptions; Codex can load its local model catalog. Exact model IDs are supported too.
- **Simple team management.** Search teams and agents, assign missing models, pause or resume an agent, and keep tasks, activity, and results together.
- **Make it yours.** Choose a name, profile photo, workspace label, greeting, theme, and launch-animation preference during setup.
- **A compact interface.** Collapse the sidebar into an icon rail. Launch animations open the workspace automatically and can be disabled in Appearance settings. Reduce Motion is respected.
- **Skills and integrations.** Use built-in skills from the composer, add your own, or connect optional MCP integrations. Hooks run only when enabled.

![Atlas Teams page with Engineering and Research demo teams](docs/images/teams-workspace.png)

## Get started

1. Open **Atlas** and complete the initial setup.
2. Open **Models** to connect an endpoint or browse the local model library.
3. Choose a model in the chat composer and send a message. Images require a model that supports them.
4. Switch to **Work** to add a project folder and start a task.
5. For delegated work, open **Agents → Teams**, create a team, and give it an objective.

Template teams choose models from available endpoints. Existing assignments are preserved when you use **Assign missing models**. If a model is unavailable, connect an endpoint and assign it before starting work.

| Shortcut | Action |
| --- | --- |
| `⌘N` | New chat |
| `⌘K` | Command palette |
| `⌘B` | Collapse or expand the sidebar |
| `⌘,` | Settings |
| `↵` / `⇧↵` | Send / new line |
| `⌘.` | Stop the current answer or run |

## Install

### Download the app

Download the macOS archive from [Releases](https://github.com/ryuzrx/atlas-harness/releases/latest), unzip it, and move **Atlas.app** to `~/Applications` or `/Applications`.

Atlas requires **macOS 13 or newer** and Python 3.9 or newer, available with the Xcode Command Line Tools. Current builds are ad-hoc signed and are not notarized. On first launch, macOS may require **Open Anyway** in **System Settings → Privacy & Security**.

Release downloads may lag behind the latest source changes. See [release notes](docs/RELEASE_NOTES.md) for shipped and unreleased updates.

### Build from source

Install the Xcode Command Line Tools and Node.js 22 or newer, then run:

```bash
git clone https://github.com/ryuzrx/atlas-harness.git
cd atlas-harness
./scripts/build_macos_app.sh
```

The builder creates `build/Atlas.app` and installs it to `~/Applications`. Python dependencies are bundled inside the app. Set `ATLAS_INSTALL_DIR` to choose a different installation folder.

## Privacy and control

Atlas stores conversations, settings, and project state on your Mac. API keys are stored in the macOS Keychain. The local backend listens on `127.0.0.1` and requires a per-launch token.

Local inference can stay on your Mac. When you choose a remote endpoint, cloud provider, or hosted agent CLI, relevant messages, attachments, and tool results may be sent to that service. Model downloads and optional integrations make their own network requests. See the [privacy policy](PRIVACY.md).

Agents have project-scoped file access, tool permissions, command controls, and approval requests. Code tasks can run in isolated Git worktrees. You review and decide what to merge. These controls have limits; review the [security policy](SECURITY.md) and [terms](TERMS.md) before granting tools access to sensitive projects.

## Development

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt pytest
.venv/bin/python -m pytest tests

cd apps/desktop
npm ci
npm run build
```

| Directory | Purpose |
| --- | --- |
| `apps/desktop` | React interface, components, themes, and motion |
| `apps/macos` | Swift shell and native file, image, and notification bridges |
| `backend/atlas` | Local API, model providers, chat, agents, and orchestration |
| `tests` | Backend and provider regression checks |
| `scripts` | App packaging and acceptance tools |

For implementation details and limits, read [Architecture](docs/ARCHITECTURE.md), [Verification](docs/VERIFICATION.md), and [Dependencies](docs/DEPENDENCIES.md). Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Atlas is licensed under [AGPL-3.0-or-later](LICENSE). Third-party components retain their licenses. Provider names and marks identify compatible services and do not imply affiliation; see [Trademarks](TRADEMARKS.md).

Copyright © 2026 the Atlas contributors.
