---
name: ssh-setup
description: Set up SSH safely.
---

Use this to set up SSH safely.

## Steps
1. Create a key: `ssh-keygen -t ed25519 -C "you@host"`, protected with a passphrase. Use ssh-agent or the Keychain.
2. Install it on the server with `ssh-copy-id`. Permissions: `~/.ssh` 700, `authorized_keys` 600.
3. Add `~/.ssh/config` entries (Host, HostName, User, IdentityFile, Port) for short commands.
4. Harden the server in `sshd_config`: `PasswordAuthentication no`, `PermitRootLogin no`, and an `AllowUsers` list. Reload, and keep your current session open while you test.
5. Add fail2ban or rate limiting, and keep packages up to date.

## Output
The commands and config snippets in order, plus a test-login step before you close your existing session.
