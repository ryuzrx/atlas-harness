---
name: swiftui-view
description: Build a clean SwiftUI view.
---

Use this to build a clean SwiftUI view.

## Steps
1. Keep the view small and declarative. Move logic into an `@Observable` model (iOS 17+) or an `ObservableObject`.
2. Choose the state tool by owner: `@State` for state the view owns, `@Binding` for a parent's state, `@Environment` for shared state.
3. Model the states: loading, content, empty and error. Do async work in `.task {}`.
4. Use system styles (fonts, `.foregroundStyle`, materials), SF Symbols and standard spacing. Support Dark Mode and Dynamic Type.
5. Use `List` or `LazyVStack` with stable `id`s. Split subviews out once a body grows long.
6. Add accessibility labels and `#Preview`s for each state.

## Output
The view, the model, and the previews.
