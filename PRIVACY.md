# Privacy Policy

_Last updated: 4 November 2026_

Atlas Harness is a local desktop app. **It does not collect, sell or share any information about you.**

## What Atlas does not do

- No telemetry, analytics, crash reporting or tracking of any kind.
- No accounts. Atlas has no server of its own.
- No advertising.

## What stays on your Mac

| Data | Where |
|---|---|
| Conversations, agents, teams, runs, settings, event log | `~/Library/Application Support/ATLAS Harness/` (SQLite database) |
| API keys for providers you connect | Your macOS login **Keychain**, never in the database or logs |
| Downloaded local models | Ollama's model folder (`~/.ollama`) |
| Logs | `~/Library/Application Support/ATLAS Harness/logs/` |

The app's backend listens only on `127.0.0.1` (your own Mac) and requires a random token that changes
every time the app starts.

## What leaves your Mac, and only when you choose

- **Model providers you connect.** When you send a message, or an agent works, using a cloud provider,
  the relevant content (messages, attachments, file excerpts the agent reads, tool results) is sent to
  that provider. It is handled under that provider's privacy policy. Local endpoints (Ollama, MLX,
  llama.cpp, LM Studio) keep everything on your Mac.
- **Agent CLIs** (Claude Code, Codex) send content to their own services under their own policies.
- **Downloads you start.** "Install Ollama" downloads the official build from GitHub, and "Download
  models" fetches models from the Ollama registry or Hugging Face.
- **Links you click** open in your default browser.
- **Optional MCP integrations** you configure receive the requests agents send to them.

## Deleting your data

Delete a conversation from the sidebar, or quit Atlas and remove
`~/Library/Application Support/ATLAS Harness/` to delete everything. API keys are removed from the
Keychain when you remove an endpoint. You can also delete them in Keychain Access by searching for
"ATLAS Harness".

## Children

Atlas is a developer tool and is not directed at children under 13.

## Changes

Changes to this policy are recorded in the repository history. Questions:
<https://github.com/ryuzrx/atlas-harness/issues>.
