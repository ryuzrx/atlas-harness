---
name: write-tests
description: Write focused tests that prove the behaviour works.
---

Use this when adding tests for new or existing behaviour.

## Steps
1. List the behaviours to prove: the happy path, edge cases (empty, one item, many items, limits), error cases, and any bug that was just fixed.
2. Follow the project's existing test framework, layout and helpers.
3. Write each test as arrange, act, assert. Use one behaviour per test and a name that says what should happen.
4. Test through the public interface. Only replace with fakes what is slow or outside your control (network, clock, randomness), and nothing more.
5. Make every test fail first, for example by breaking the code briefly, so you know it can catch a regression.
6. Keep tests fast and deterministic: fixed seeds, frozen time, no sleeps.

## Watch out for
- Asserting on implementation details that will change.
- Snapshot tests that nobody reads.
- Tests that pass even when the feature is deleted.

## Output
The tests, a one-line note on what each one proves, and the command that runs them.
