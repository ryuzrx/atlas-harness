---
name: game-loop-debug
description: Debug game logic and timing.
---

Use this to debug game logic and timing problems.

## Steps
1. Reproduce it reliably: record the inputs, and fix the random seed and frame rate where you can.
2. Log or draw the state on screen each frame or tick for the objects involved.
3. Check update order: input → logic → physics → render. Check whether things run in fixed or variable updates.
4. Look for frame-rate dependence: multiply movement by delta time, and use fixed timesteps for physics.
5. Look for state bugs: events that fire twice, listeners never removed, objects destroyed but still referenced.
6. Fix it and add a check or test that catches it.

## Output
The cause, the evidence, the fix, and how you verified it.
