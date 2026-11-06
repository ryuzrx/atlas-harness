# Troubleshooting Atlas

[Overview](../README.md) · [User guide](USER_GUIDE.md)

## A model connection fails

Open **Models** and test the endpoint. Check that its server is running, the base URL is correct, and the model is available there. A local server, a cloud API, and an agent CLI use different setup paths.

- For Ollama, start the service and check the configured address.
- For other local servers, verify the port and compatible API path in that server's configuration.
- For cloud APIs, check the API key, account access, rate limits, and model ID.
- For a remote server, check network reachability from the Mac running Atlas.

A model appearing in a catalog does not guarantee that the account can run it.

## Downloads say “All connection attempts failed”

Distinguish two connections: Atlas must reach the Ollama server, and that server must reach the model registry.

1. Test the Ollama endpoint in **Models**.
2. Start the local runtime if it is stopped. Atlas can start its managed Ollama service.
3. Confirm the download tag is valid and that the server has network access and free disk space.
4. Retry from the download controls.

If the endpoint is remote, downloads run on the remote server. Changing a model folder on this Mac does not reconfigure that server's storage.

## A model is downloaded but feels slow

Downloaded files are stored on disk; a model may still need to load into memory. The first request can be slower than later ones.

Use a model that fits available memory, reduce unnecessary context, and avoid competing inference workloads. More agents do not necessarily make local inference faster: they may share one provider queue and one loaded model. Use smaller tasks and review execution limits when a run repeatedly reaches its step budget.

## An image causes a multimodal error

The selected model or provider path does not support the image request. Choose a vision-capable model or remove the image and send text. Check capabilities for the exact model rather than assuming every model from a provider supports images.

## Claude Code or Codex is missing

Install and sign in to the CLI first. If it works in your terminal but Atlas cannot find it, open the endpoint settings and set the binary path. Desktop apps may have a different search path from your terminal.

The default model uses the CLI's configuration. An exact model ID must be accepted by that CLI and your account. Codex catalog entries depend on its local cache and may change after sign-in or CLI updates.

## A team cannot start

Check the team's lead, assigned model, status, and archive state. The Work view links to the relevant management screen when setup is incomplete.

Automatic model assignment uses available non-CLI model endpoints. It fills missing assignments and preserves complete existing choices. If all available connections are CLI runtimes, choose the agents' models manually.

## Team suggestions fail or look basic

Atlas can use a connected model for suggestions. When discovery or inference fails, it falls back to matching keywords against the available templates. You can select templates yourself and edit the resulting team.

## The agent is waiting

Look for approval requests, blocked dependencies, or a paused agent. Inspect **Activity** and the current task before retrying. A retry can repeat actions, so review files and results first.

## The sidebar is only icons

Use the sidebar's expand button or `⌘B`. The state is remembered. Settings and the profile menu remain available in the collapsed rail.

## Change or disable the welcome animation

Open **Settings → Appearance**. Toggle **Launch animation**, **Personalized greeting**, or **Reduce motion**. Change the display name in the profile menu or General settings. The animation opens the workspace automatically.

## Reopen first-time setup

Open **Settings → General → Welcome guide → Show**. This lets you revisit personalization and model setup. Profile and workspace preferences are local to Atlas.

## Report a bug

Include the Atlas version, macOS version, the affected screen, reproduction steps, and the error text. Share a screenshot only after checking names, account details, folder paths, and conversation content. Never include API keys, the local launch token, your database, or private project files.

For security-sensitive reports, follow [SECURITY.md](../SECURITY.md).
