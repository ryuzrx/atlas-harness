---
name: roblox-lua
description: Write clean Roblox Lua.
---

Use this to write clean, safe Roblox Luau code.

## Steps
1. Put code in the right place: `ServerScriptService` for server logic, `StarterPlayerScripts` or `StarterGui` for the client, and shared modules in `ReplicatedStorage`.
2. Never trust the client. Validate every `RemoteEvent` and `RemoteFunction` call on the server (type, range, cooldown, ownership). The server owns currency, damage and saves.
3. Use `ModuleScript`s for shared logic. Use `--!strict` and Luau type annotations.
4. Use `task.wait`, `task.spawn` and `task.delay` instead of the old `wait` and `spawn`. Disconnect connections and clean up when objects are removed.
5. DataStores: wrap calls in `pcall`, retry with backoff, save on leave and on `BindToClose`, and use `UpdateAsync` for values that matter.
6. Performance: avoid heavy loops in `Heartbeat` or `RenderStepped`, reuse instances, and use `CollectionService` tags for groups of objects.

## Output
The scripts with where each one goes, the remote API, and test steps in Studio (including a multi-client test).
