---
name: type-hints
description: Add useful type hints.
---

Use this to add useful type hints.

## Steps
1. Start at public functions and module boundaries: parameters and return types.
2. Use modern syntax: `list[int]`, `X | None`, and `from __future__ import annotations` on older Python versions.
3. Prefer precise types: `TypedDict` or dataclasses for dict-shaped data, `Literal` for fixed strings, `Protocol` for duck typing, generics where they help.
4. Accept abstract types (`Iterable`, `Mapping`) and return concrete ones.
5. Avoid `Any`. If you must use it, add a comment saying why.
6. Run mypy or pyright and fix the errors properly, not with `ignore` comments.

## Output
The annotated code and the type-checker result.
