---
name: property-testing
description: Use property-based testing.
---

Use this to apply property-based testing.

## Steps
1. Find properties that are always true: a round trip (decode(encode(x)) == x), invariants (sorting keeps the length and the items), doing it twice changes nothing, matching a simple reference implementation.
2. Use the language's tool: Hypothesis (Python), fast-check (JavaScript and TypeScript), proptest (Rust).
3. Write generators for valid inputs, including edge values (empty, huge, unicode, negative).
4. Let the tool shrink a failure to the minimal example, then turn it into a regular regression test.
5. Keep the runtime sensible, with an example count and a deadline.

## Output
The properties in plain words, the test code, and any bugs it found.
