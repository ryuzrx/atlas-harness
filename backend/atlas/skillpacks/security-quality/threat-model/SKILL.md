---
name: threat-model
description: Think through how a system could be attacked.
---

Use this to think through how a system could be attacked.

## Steps
1. Draw the system: components, data stores, data flows and trust boundaries.
2. List the assets worth protecting (data, money, accounts, availability) and who might attack (outsider, user, insider).
3. Walk through STRIDE at each boundary: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege.
4. Rate each threat by likelihood and impact.
5. Note existing controls and the gaps. Propose mitigations for the top risks.

## Output
A diagram description, a threat table (threat, where, likelihood, impact, mitigation), and the top 3 actions.
