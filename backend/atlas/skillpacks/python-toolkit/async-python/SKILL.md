---
name: async-python
description: Use asyncio correctly.
---

Use this to write correct asyncio code.

## Steps
1. Only use async for I/O-bound work (network, disk, subprocesses). CPU-heavy work goes in `asyncio.to_thread` or a process pool.
2. Never call blocking functions (`time.sleep`, `requests`, heavy file reads) inside a coroutine. Use async libraries or `to_thread`.
3. Run things concurrently with `asyncio.gather` or a `TaskGroup` (Python 3.11+). Keep references to tasks you create.
4. Limit concurrency with a `Semaphore`. Set timeouts with `asyncio.timeout()`.
5. Handle cancellation: clean up in `finally`, and don't swallow `CancelledError`.
6. Start with `asyncio.run(main())` at the top level only.

## Output
The code, with notes on where the concurrency happens and how errors and cancellation are handled.
