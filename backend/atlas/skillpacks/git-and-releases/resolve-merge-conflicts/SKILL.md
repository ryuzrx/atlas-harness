---
name: resolve-merge-conflicts
description: Resolve merge conflicts without losing work.
---

Use this when git reports conflicts during a merge, rebase or cherry-pick.

## Steps
1. Check the state: `git status`. Note whether you're merging or rebasing, and which side is "ours" and which is "theirs" (they swap during a rebase).
2. For each conflicted file, understand what each side was trying to do. Look at the commits (`git log --merge -p <file>`) rather than just the markers.
3. Combine both intents. Taking one side wholesale is right only if the other side's change is truly obsolete.
4. Remove all conflict markers. Search for `<<<<<<<`, `=======` and `>>>>>>>`.
5. Build and run the tests before you continue. Conflicts often hide semantic breaks, such as a renamed function on one side and a new call to the old name on the other.
6. Finish with `git add` and then `git merge --continue` or `git rebase --continue`.

## Watch out for
- `git checkout --theirs .` or a force-push without understanding what's lost.
- Lockfiles. Regenerate them with the package manager instead of hand-merging.

## Output
Each file, how you resolved it, and confirmation that the build and tests pass.
