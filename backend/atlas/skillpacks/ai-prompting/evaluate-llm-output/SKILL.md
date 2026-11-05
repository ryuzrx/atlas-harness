---
name: evaluate-llm-output
description: Judge whether a model answer is good.
---

Use this to judge whether a model's answer is good.

## Steps
1. Define the criteria for this task: correct, complete, follows instructions, grounded in sources, right format and tone, and safe.
2. Check facts and calculations independently. Don't trust a confident tone.
3. Check it against the prompt's constraints one by one.
4. Look for hallucinations: invented citations, APIs, numbers or quotes.
5. Score each criterion (for example 1 to 5) with a reason, and give an overall verdict.
6. When comparing models, use the same prompts, blind the comparison, and test several cases.

## Output
A scorecard, the specific errors with quotes, and a suggested prompt fix if the failure was caused by the prompt.
