---
name: pr-description
description: Write a pull request description reviewers can act on.
---

Use this to write a pull request description that reviewers can act on.

## Steps
1. Summary: one or two sentences on what changes and why.
2. Context: link the issue or explain the problem. Note anything a reviewer must know first.
3. Changes: a short list of the main changes, grouped by area. Point out anything risky.
4. Testing: what you ran and how a reviewer can verify it (commands, steps, screenshots for UI).
5. Rollout: migrations, flags, config changes and backward compatibility.
6. Open questions for reviewers, if any.

## Watch out for
- Dumping the commit list.
- Hiding a risky change in the middle of a long list.

## Output
A Markdown description using those headings. Leave out any heading that doesn't apply.
