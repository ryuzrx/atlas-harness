# Atlas user guide

[Overview](../README.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Release notes](RELEASE_NOTES.md)

## Set up your workspace

On first launch, review the usage notice and use the welcome guide to choose your preferences and connect a model. You can skip model setup and explore the interface first.

In **Make Atlas yours**, set:

- Your display name and a local profile photo.
- A workspace label for the sidebar.
- Light or Dark appearance and interface size.
- Comfortable or wide chat layout.
- Enter or Command-Enter to send messages.
- Full or reduced motion.
- Launch animation on or off, with a named or Atlas-only greeting.
- A full sidebar or an icon rail.

Profile details remain on your Mac. Open the profile menu to edit them later. You can reopen the setup guide from **Settings → General → Welcome guide**. Normal launch animations open the app automatically.

## Connect a model

Open **Models → Add endpoint**. Choose the connection type that matches the service you want to use.

### Ollama

Use a local Ollama installation or let Atlas install its managed runtime. Start the service, then browse **Model library** to choose a model. Search by family or company, or use the categories.

The model's download size is not its full memory requirement. A model also needs memory for inference and context. Larger context windows and concurrent requests can increase usage.

Downloads appear in the bottom tray. You can stop a transfer, retry an error, and keep navigating while it runs. The tray is separate from loading a model into memory.

The model-folder control applies to Atlas-managed Ollama. Changing the folder does not move files you already downloaded. An independently running or remote Ollama service keeps its own storage configuration.

### Other local servers

Start the MLX-LM, llama.cpp, LM Studio, vLLM, or compatible server before adding it. Choose its preset or a custom endpoint and use the base URL exposed by that server. Ports vary by server configuration.

Atlas connects to a running server; adding an endpoint does not install every third-party runtime automatically.

### Cloud APIs

Choose a preset, enter your own API key, and test the connection. Credentials are stored in the macOS Keychain. Account access, usage charges, rate limits, and model availability are controlled by the provider.

For a compatible service without a preset, choose **Custom endpoint** and enter its base URL. Some services expose a model list; others require a configured model ID.

### Claude Code and Codex

Install and sign in to the CLI you want to use, then add or enable its connection in Atlas. Configure the binary path if Atlas cannot find it.

- **Default** uses the CLI's own model configuration.
- Claude Code offers readable entries for its model aliases.
- Codex can read selectable model metadata from its local catalog.
- **Use an exact model ID** selects a model identifier supported by that runtime and account.

The local catalog is a discovery aid, not a guarantee of current account access. Atlas does not expose catalog identity or instruction fields in the model list. A Codex local-model configuration uses its local provider rather than the cloud catalog.

Claude Code and Codex run through their own command-line apps and use the account already signed in there. Atlas does not bypass or increase subscription limits. Complex tasks and multi-agent runs can use more of your plan allowance because the underlying CLI performs the model work.

### Free online models

In the Welcome guide, choose **Start with free online models**. The provider picker includes OpenRouter, Groq, Google Gemini, Mistral, Cohere, NVIDIA NIM, Hugging Face Inference, Cerebras, and Fireworks AI. Each card identifies whether the offer is a free tier, evaluation access, monthly credits, or a one-time trial. Check the linked provider terms for current eligibility, model access, limits, expiry, and payment requirements. Trial credits are not an unlimited free service.

Use the provider's key link to create your own account and API key, then choose **Test and connect**. Failed connection tests do not save the provider. After connecting, choose a model from the live catalog and select **Use this model** to carry that choice into your first chat. OpenRouter setup only lists free routes, including `openrouter/free`, which chooses an available free model. Other providers can list paid models too; your account plan determines the free allowance and billing.

Add a project folder in the next step. At the end of setup, **Start coding** opens Work so you can choose your project; **Start chatting** opens a conversation with your selected model. Enable the project tools you want the model to use. Free quotas may run out faster during agent tasks because one task can make multiple model requests. Messages and code are sent to the selected provider under its data policies.

OpenCode's free inference tier is restricted to OpenCode itself, so Atlas cannot call that tier as a regular model endpoint. Use OpenCode directly for its free tier, or use Atlas's OpenRouter option or a local model.

## Chat with a model

Open a new chat and use the model picker in the composer. Search by model or provider name, then select an entry. Your current choice is highlighted when you reopen the picker.

Write a message and send it. The reply streams into the conversation, with Markdown and code formatting. Use the stop control to interrupt the current answer or run.

The sidebar keeps conversation history. Search it, rename a chat, or delete it from its action menu. Collapsing the sidebar hides the history list but keeps navigation available as icons.

### Files and images

Use the plus button, drag and drop, or paste a supported image. Text files are included as attachment content. Images require a vision-capable model and provider path.

If the provider reports that a model does not support multimodal requests, select a compatible model or remove the image. Atlas cannot add image understanding to a text-only model. Attachment size and file-type limits are reported in the interface.

### Project context and tools

Choose a project to provide project context. Enable only the tools needed for the task. With agent tools enabled, a model conversation can become an Atlas Assistant run rather than a direct reply.

An agent selected in the composer uses its own model. A team uses the models assigned to its members. Change those assignments in agent or team management.

### Access and Atlas Computer Use

Choose **Read only** to let an Atlas-managed agent inspect project files without editing or running commands. **Workspace** is the default and uses the selected project tools under Atlas's command and file protections.

Choose **Atlas Computer Use** to let an eligible model capture the current screen and control visible Mac apps for that chat. macOS asks for Screen Recording and Accessibility permission. Clicks, typing, and key presses each pause for your approval. Screen frames sent to hosted providers or custom endpoints require your confirmation, including custom endpoints on `localhost`. Screenshots are not saved by default. **Stop** prevents later actions; a Mac action already in progress may finish.

Atlas can use project-scoped commands to build your app, start its local preview server, and open that preview in your browser. Computer Use requires a model with verified image and tool support; dynamic free-model routers and CLI modes may not qualify. A team with varied model assignments cannot use Computer Use in this version.

Atlas-managed agent and team runs can ask you for missing context with a question card. Answering the card resumes the same run. Direct model conversations do not pause for question cards.

## Work on a project

Switch to **Work** and choose a source. **Local folder** is selected by default and lets you add a folder already on this Mac. **Git repository** clones a remote into a local folder on this Mac; it is not cloud execution. Opening a project shows a chat-style composer with that folder selected as project context.

The session panel helps inspect project context, the environment, and Git changes.

In a Git project, writing tasks can run on isolated branches and worktrees. Review the diff and merge explicitly when you are satisfied. Atlas checks for conflicts and protects uncommitted work during merges. Non-Git folders have different isolation limits; keep backups and review results.

A model's final message is not proof that its changes are correct. Inspect the run activity, changed files, and any verification it performed.

## Create and manage a team

Open **Agents → Teams → New team**. Choose a template and optional project, or start empty. Customize the name and description as needed.

Available templates cover Engineering, Research, Design, Quality Assurance, and DevOps. They are editable starting points.

Automatic assignment chooses models from available non-CLI endpoints by agent role. During creation, expand **Customize setup** to choose models for planning/review, engineering, and research. You can remember those choices for later teams.

In an existing team's **Agents** view, **Assign missing models** fills unconfigured agents without replacing complete manual assignments. Manually chosen models can still become unavailable later.

### Start work

Open the team and enter an objective in **Work**. The team needs a lead with an assigned model. Resume a paused lead before starting. Restore archived teams before submitting new work.

The lead plans and delegates tasks. Follow execution in **Activity**, review the task history in **Work**, and inspect results and memory in **Resources**. Approval requests can pause progress until you decide.

### Manage members

The Agents page provides team, status, and text filters. Select an agent to edit its role, model, instructions, permissions, or execution limits. Use the action menu to pause, resume, or duplicate it.

Additional controls in the agent inspector let you move an agent, save a preset, or delete it when allowed. Changing a model does not automatically make that model available on its provider.

### Shared memory

Team and project memory retain notes used during future work. Agent-written notes are unverified until you mark them verified. Review or remove stale information rather than assuming it is authoritative.

## Skills, plugins, and integrations

Type `/` at the start of a composer message to choose a skill. Built-in packs provide reusable workflows; custom skills can be added from folders or discovered through the skills finder.

Plugins, hooks, and MCP integrations add behavior and access. Review what you enable. Hooks can run commands, and integrations can send content to external systems. Imported configuration should be reviewed before use.

## Data and privacy

Atlas stores its database and state under `~/Library/Application Support/ATLAS Harness/`. The legacy directory name is retained for compatibility. API keys live in Keychain, and local model files are managed by their runtime.

The app has a local backend with a per-launch token. Remote endpoints, cloud models, agent CLIs, downloads, and optional integrations can make network requests. See [Privacy](../PRIVACY.md) for details and deletion instructions.
