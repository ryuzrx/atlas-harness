---
name: error-handling
description: Handle errors well.
---

Use this to handle errors well.

## Steps
1. Sort errors into expected (validation, not found, conflict) and unexpected (bugs, outages).
2. Validate input at the edges and return clear, actionable messages.
3. Never swallow errors. Either handle them meaningfully or pass them up with context.
4. Retry only failures that are temporary, with backoff and jitter, and only for operations that are safe to repeat.
5. Log once at the boundary, with context (request ID, user, the operation), without secrets.
6. Show users a friendly message. Keep the details in logs and error tracking.

## Output
An error taxonomy for the code, the handling pattern, and an example.
