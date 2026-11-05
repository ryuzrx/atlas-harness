---
name: e2e-testing
description: Write reliable end-to-end tests.
---

Use this to write reliable end-to-end tests.

## Steps
1. Cover only the critical user journeys (sign up, log in, checkout, the main workflow). Leave the details to unit tests.
2. Use a modern runner (Playwright or Cypress) with auto-waiting. Never use fixed sleeps.
3. Select elements by role, label or text (`getByRole`), or by stable test IDs, not by CSS structure.
4. Give each test its own data, created through the API or seeds, and clean it up afterwards. Tests must not depend on each other.
5. Stub third-party services where you can. Keep the real backend for the journey under test.
6. Capture a trace, screenshot or video when a test fails. Run in CI on every pull request.

## Output
The test files, the data setup, and the run commands.
