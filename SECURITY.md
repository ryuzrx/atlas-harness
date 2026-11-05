# Security policy

Atlas Harness runs AI agents that can read files and execute commands, so security reports are taken
seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's **Report a vulnerability** button (Security →
Advisories) on this repository instead. Include:
- what an attacker can do, and the affected version or commit;
- steps to reproduce (a proof of concept if possible).

You'll get an acknowledgement within a few days, and we'll coordinate a fix and disclosure with you.

## In scope

- Escaping the project folder: path traversal, symlinks, or writes outside the workspace.
- Bypassing the command policy, the approvals or `sandbox-exec`.
- Leaking API keys, tokens or file contents. This includes leaks through logs, the database or the
  network.
- Reaching the local backend from another origin or host (it must stay `127.0.0.1`-only and
  token-protected).
- Prompt injection that leads to any of the above without user approval.

## Out of scope

- What a model *says*. Model output is untrusted by design.
- Risks you accept explicitly, such as setting the command policy to "auto" or approving a command.
- Third-party providers' own security.
