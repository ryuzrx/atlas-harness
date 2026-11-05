---
name: auth-flow
description: Design sign-in and permissions safely.
---

Use this to design sign-in and permissions safely.

## Steps
1. Prefer a proven provider or library (OAuth or OIDC, passkeys) over building your own crypto.
2. Passwords, if you use them: hash with argon2id or bcrypt, rate-limit login, and use generic error messages. Offer MFA.
3. Sessions: HttpOnly, Secure, SameSite cookies with short lifetimes and rotation. With JWTs, use a short expiry and refresh tokens you can revoke.
4. Authorisation: check on the server for every request, including that the user owns the object. Deny by default. Use roles or permissions in one place.
5. Recovery: single-use, expiring reset links. Notify the user when security settings change.
6. Log auth events without logging secrets.

## Output
The flow (steps or a diagram), the data model, the endpoints, and a security checklist.
