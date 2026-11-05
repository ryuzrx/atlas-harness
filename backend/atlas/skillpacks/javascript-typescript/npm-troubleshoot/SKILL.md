---
name: npm-troubleshoot
description: Fix npm install and version problems.
---

Use this to fix npm install and version problems.

## Steps
1. Read the first error. Note the Node and npm versions (`node -v`, `npm -v`) and compare them with `engines` and any `.nvmrc`.
2. Peer dependency conflicts: find the package pair with `npm ls <pkg>`, then align versions. Use `--legacy-peer-deps` only as a deliberate last resort.
3. Integrity or cache errors: run `npm cache verify`, then reinstall. Only delete `node_modules` and the lockfile if nothing else works, and say that you did.
4. Native build failures: check the build tools (Xcode CLT, python), the architecture, and the Node version against the package.
5. Wrong versions installed: check the lockfile, `overrides`, and workspace hoisting.

## Output
The cause, the exact commands that fixed it, and how to stop it happening again (for example pinning Node).
