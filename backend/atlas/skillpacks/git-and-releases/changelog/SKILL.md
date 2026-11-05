---
name: changelog
description: Turn commits into a readable changelog.
---

Use this to turn commits or merged pull requests into notes that people can read.

## Steps
1. Gather the changes since the last release: `git log <last-tag>..HEAD --oneline`, or the list of merged pull requests.
2. Drop the noise: merge commits, typo fixes, internal refactors, and CI and dependency bumps (unless they affect users).
3. Group what's left: Added, Changed, Fixed, Removed, Security. Put breaking changes first, marked clearly.
4. Rewrite each item from the user's point of view: what they can now do or what stopped going wrong. Use the past tense and no jargon.
5. Link the pull request or issue numbers where the project uses them.
6. For each breaking change, add a migration line: what users need to change.

## Output
A Markdown section headed with the version and date, following the project's existing changelog format if there is one.
