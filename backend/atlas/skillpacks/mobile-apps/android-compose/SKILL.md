---
name: android-compose
description: Build a Jetpack Compose screen.
---

Use this to build a Jetpack Compose screen.

## Steps
1. Split it into a stateless composable that takes state and event callbacks, and a screen-level composable that connects it to a ViewModel.
2. Keep state in the ViewModel as a `StateFlow<UiState>`. Collect it with `collectAsStateWithLifecycle()`.
3. Model every state: loading, content, empty and error.
4. Use Material 3 components and theme tokens, not hard-coded colours or sizes.
5. Use `LazyColumn` for lists, with stable `key`s. Hoist state so the composables can be previewed and tested.
6. Add `@Preview`s for each state, plus content descriptions and touch targets of at least 48dp.

## Output
The composables, the UiState, the ViewModel outline, and the previews.
