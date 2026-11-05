---
name: agent-design
description: Design an AI agent that stays on track.
---

Use this to design an AI agent that stays on track.

## Steps
1. Define the job narrowly: its inputs, the outputs, and what "done" means.
2. Give it the fewest tools it needs. Each tool should have a clear name, description and input schema, and return errors as text the model can act on.
3. Write the system prompt: role, goal, rules, the steps to follow, and when to stop or ask for help.
4. Add guardrails: confirm before destructive actions, limit steps and budget, and restrict access to what's needed.
5. Manage context: summarise long histories, keep important facts in a scratchpad or memory, and trim tool output.
6. Evaluate it on a set of real tasks, including failure cases, and improve from the transcripts.

## Output
The agent spec (job, tools, prompt, guardrails) and an evaluation plan.
