---
name: shell-scripting
description: Write a safe shell script.
---

Use this to write a safe shell script.

## Steps
1. Start with `#!/usr/bin/env bash` and `set -euo pipefail`.
2. Quote every variable (`"$var"`). Use `[[ ]]` for tests and `$(...)` for command output.
3. Check inputs and print usage. Give variables defaults (`${VAR:-default}`).
4. Use `mktemp` for temporary files, with `trap 'rm -rf "$tmp"' EXIT` to clean up.
5. Make destructive steps explicit, and offer a `--dry-run` where it makes sense.
6. Run ShellCheck and fix the warnings.

## Watch out for
- `rm -rf $DIR/` with an empty variable.
- Parsing `ls` output.
- `cd` without checking that it worked.

## Output
The script, how to use it, and the ShellCheck result.
