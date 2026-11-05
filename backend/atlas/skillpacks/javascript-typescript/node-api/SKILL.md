---
name: node-api
description: Build a small Node API.
---

Use this to build a small Node API.

## Steps
1. Pick a framework that fits (Express, Fastify, or Hono), plus TypeScript.
2. Structure it as routes → handlers → services, with config read from environment variables and validated at startup.
3. Validate every request body and query with a schema (zod, or the framework's own schema).
4. Handle errors centrally: a consistent JSON error shape, the right status codes, and no stack traces in production.
5. Add logging (pino), CORS rules, rate limiting on public routes, and a health endpoint.
6. Test the routes with supertest or the framework's inject function.

## Output
The file layout, the code, an `.env.example`, and run and test commands.
