---
name: commit-message
description: Write a clear commit message from the changes.
---

Use this to write a commit message from staged changes.

## Steps
1. Read the diff (`git diff --staged`). Work out the single main reason for the change.
2. Subject line: imperative mood ("Add", "Fix", "Remove"), at most 72 characters, no full stop. Follow the repo's convention (for example Conventional Commits) if it uses one.
3. Body (optional): why the change was needed, how it works if that isn't obvious, and any side effects or follow-ups. Wrap at 72 characters.
4. Reference issues the way the project does (for example "Fixes #123").
5. If the diff does two unrelated things, suggest splitting it into two commits.

## Watch out for
- Describing what the diff obviously shows ("changed line 4"). Explain why instead.
- Vague subjects like "updates" or "fix stuff".

## Output
The ready-to-paste commit message, nothing else, unless you're suggesting a split.
