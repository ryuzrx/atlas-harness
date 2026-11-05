---
name: eslint-setup
description: Set up linting and formatting.
---

Use this to set up linting and formatting.

## Steps
1. Use ESLint's flat config (`eslint.config.js`) with the recommended rules plus `typescript-eslint` for TypeScript.
2. Add framework plugins as needed (react-hooks, jsx-a11y).
3. Let Prettier (or the project's formatter) handle formatting, and turn off ESLint's style rules that conflict with it.
4. Add scripts: `lint`, `lint:fix` and `format`.
5. Run them in CI and on staged files with lint-staged.
6. Fix the existing errors in one separate commit.

## Output
The config files, package.json scripts, and the commands to run.
