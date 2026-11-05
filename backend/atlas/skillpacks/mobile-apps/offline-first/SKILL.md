---
name: offline-first
description: Design an app that works offline.
---

Use this to design an app that works without a connection.

## Steps
1. Decide what must work offline: reading, creating, editing, or all three.
2. Store data locally (SQLite, Room, Core Data or SwiftData, IndexedDB) and treat that as the source of truth for the UI.
3. Queue changes made offline, with IDs created on the device and timestamps.
4. Sync in the background when online. Retry with backoff, and make the sync operations safe to repeat.
5. Choose a conflict rule: last write wins, merge by field, or ask the user. Document it.
6. Show the sync state clearly (offline, syncing, failed) without blocking the user.

## Output
The data flow, the sync design, the conflict rule, and the states shown in the UI.
