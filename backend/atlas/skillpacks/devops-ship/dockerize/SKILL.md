---
name: dockerize
description: Containerise an app properly.
---

Use this to put an app in a container properly.

## Steps
1. Choose a small, official, pinned base image (for example `node:22-slim`, `python:3.12-slim`).
2. Use a multi-stage build: build tools in the first stage, only the runtime and artifacts in the final one.
3. Order layers for caching: copy the lockfile, install dependencies, then copy the source.
4. Add a `.dockerignore` (node_modules, .git, env files, build output).
5. Run as a non-root user. Use a `HEALTHCHECK` where it's useful. Log to stdout.
6. Configure through environment variables. Never bake secrets into the image.
7. Provide a docker-compose file for local development if there are services (database, cache).

## Output
The Dockerfile, .dockerignore, an optional compose file, and the build and run commands.
