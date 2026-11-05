---
name: sql-helper
description: Write and check SQL queries.
---

Use this to write or review SQL.

## Steps
1. Confirm the database (Postgres, MySQL, SQLite, BigQuery…), the tables, the columns and the keys. Ask for the schema if you don't have it.
2. Write the query clearly: explicit column lists, readable aliases, one clause per line, and CTEs for multi-step logic.
3. Check the joins: the right join type and keys, and no accidental row multiplication (compare counts).
4. Handle NULLs and duplicates deliberately. Check the grouping and aggregation.
5. For performance, filter early, avoid `SELECT *` on big tables, check indexes, and use `EXPLAIN` when it's slow.
6. Use parameters for user input. Never build SQL by gluing strings together.

## Output
The query, a plain explanation of what it returns, assumptions, and a quick check query (for example a count) to verify it.
