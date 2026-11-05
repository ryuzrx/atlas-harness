---
name: security-review
description: Look for common security problems.
---

Use this to look for common security problems in code or a design.

## Steps
1. Map the inputs (requests, files, environment, third-party data) and the sensitive actions (auth, payments, file access, admin).
2. Injection: SQL, shell, template, path traversal, deserialisation. Is the input validated and parameterised?
3. Authentication and authorisation: is every sensitive endpoint checked on the server side, including object ownership (IDOR)?
4. Secrets: none in code, logs, client bundles or error messages. Keys are scoped and rotatable.
5. Web: XSS (output encoding), CSRF, CORS, cookies (HttpOnly, Secure, SameSite), security headers.
6. Data: encryption in transit and at rest, minimal collection, safe logging.
7. Dependencies: known vulnerabilities.

## Output
Findings by severity, each with location, how it could be exploited, impact and fix. Only report what you can point to in the code.
