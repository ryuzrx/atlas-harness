---
name: design-rest-api
description: Design a clear REST API.
---

Use this to design a clear REST API.

## Steps
1. Model resources as nouns (`/projects/{id}/tasks`). Use HTTP methods for the actions.
2. Use status codes correctly: 200, 201 (with Location), 204, 400, 401, 403, 404, 409, 422, 429, 500.
3. Use one error shape everywhere, for example `{ "error": { "code", "message", "details" } }`.
4. Paginate lists (cursor-based for large or changing data), and support filtering and sorting through query parameters.
5. Make retries safe: PUT and DELETE are naturally repeatable; use idempotency keys for POSTs that cost money or create things.
6. Version deliberately (in the URL or a header). Document everything with OpenAPI.

## Output
An endpoint table (method, path, purpose, request, response, errors) and example requests.
