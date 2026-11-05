---
name: typescript-migrate
description: Move a JavaScript project to TypeScript safely.
---

Use this to move a JavaScript project to TypeScript safely.

## Steps
1. Add a `tsconfig.json` with `allowJs` and `checkJs: false`, and `strict` planned for later. Make sure the build and tests still pass.
2. Install `@types` packages for your dependencies.
3. Convert files from the leaves up (utilities first), one small pull request at a time, renaming `.js` to `.ts`.
4. Type the boundaries first: API responses, function signatures, shared models.
5. Use `unknown` plus narrowing instead of `any`. Track the remaining `any` uses.
6. Turn on strict checks one at a time (`noImplicitAny`, `strictNullChecks`, …) and fix as you go.

## Output
A migration plan with the order of steps, the tsconfig, and the first converted files.
