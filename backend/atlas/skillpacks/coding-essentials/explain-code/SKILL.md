---
name: explain-code
description: Explain what code does in plain language.
---

Use this when someone wants to understand what a piece of code does.

## Steps
1. Ask about or infer the reader's level. Explain for that person, not for an expert.
2. Start with one sentence on the purpose: what problem does this code solve?
3. Walk through the main flow in order: inputs, the key steps, outputs and side effects (files, network, database, global state).
4. Explain any unusual idioms, library calls or language features the first time they appear.
5. Point out the non-obvious parts: hidden assumptions, error handling, performance traps and anything surprising.
6. If it helps, give a tiny worked example with real values tracing through.

## Watch out for
- Reading every line aloud. Group the code into meaningful chunks.
- Guessing what a function you haven't seen does. Say when you're inferring.

## Output
A purpose sentence, a step-by-step walkthrough, then "Things to notice". Use short code quotes with line references rather than pasting the whole file again.
