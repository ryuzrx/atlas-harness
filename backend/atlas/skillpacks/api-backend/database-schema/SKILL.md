---
name: database-schema
description: Design a database schema.
---

Use this to design a database schema.

## Steps
1. List the entities, their relationships (one-to-one, one-to-many, many-to-many) and the main queries.
2. Normalise to about 3NF first. Denormalise only for measured read needs.
3. Choose keys (surrogate IDs, UUIDv7 or bigint), constraints (NOT NULL, UNIQUE, foreign keys, CHECK) and types (proper timestamps with time zones, numeric types for money).
4. Add indexes for the real query patterns: foreign keys, filters and sort columns. Avoid indexing everything.
5. Plan for soft deletes, audit fields (created and updated at), and multi-tenancy if needed.
6. Write it as migrations.

## Output
The table definitions (SQL), an ER summary, the index rationale, and example queries.
