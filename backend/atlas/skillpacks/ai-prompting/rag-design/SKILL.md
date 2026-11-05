---
name: rag-design
description: Design retrieval-augmented generation.
---

Use this to design retrieval-augmented generation.

## Steps
1. Define the questions users will ask and what a good answer cites.
2. Prepare the documents: clean them, chunk by structure (headings, paragraphs) at a few hundred tokens with a little overlap, and keep metadata (source, date, section).
3. Retrieve with hybrid search (keywords plus embeddings), then rerank. Retrieve the top 20 to 50 and keep the best 5 to 10.
4. Prompt: answer only from the given context, cite sources, and say when the context doesn't contain the answer.
5. Evaluate retrieval (does the right chunk come back?) and answers (correct, grounded) separately, on a fixed question set.
6. Keep the index fresh and handle access permissions for each user.

## Output
The pipeline design, the parameters, the prompt, and the evaluation plan.
