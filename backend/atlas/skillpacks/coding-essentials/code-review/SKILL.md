---
name: code-review
description: Review a change for bugs, risks and missing tests.
---

Use this when someone asks you to review a diff, a pull request or a file before it ships.

## Steps
1. Read the whole change first. Work out what it is meant to do from the title, description or commit message. If that's unclear, say what you think the intent is.
2. Check correctness first: wrong conditions, off-by-one errors, unhandled null or empty values, missing awaits, race conditions, and errors that are swallowed silently.
3. Check edges: empty input, very large input, unicode, time zones, concurrent callers, and failure of every network or disk call.
4. Check safety: user input reaching SQL, shell, HTML or file paths; secrets in code or logs; missing permission checks.
5. Check tests: does a test fail without this change? Are the risky paths covered?
6. Only then look at naming, structure and duplication.

## Watch out for
- Don't pad the review with style nits. If a linter could catch it, mention it once at most.
- Don't claim a bug you haven't traced. If you're unsure, say "possible" and explain what would confirm it.
- Read the code around the diff before you call something unused or wrong.

## Output
A short verdict (ship / ship after fixes / needs rework), then findings ordered by severity. Each finding gives the file and line, what goes wrong, a concrete input that triggers it, and a suggested fix.
