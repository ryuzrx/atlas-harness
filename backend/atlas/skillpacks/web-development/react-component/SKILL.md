---
name: react-component
description: Write a clean React component.
---

Use this to write a clean React component.

## Steps
1. Define the props interface first: the minimum needed, clear names, sensible defaults, and typed if the project uses TypeScript.
2. Keep state as low and as small as possible. Work out values from props or state instead of syncing copies.
3. Use effects only to sync with outside systems. Clean them up. Get the dependency array right.
4. Handle every state: loading, empty, error, and very long or very many items.
5. Make it accessible: semantic elements, labels, keyboard support and visible focus.
6. Follow the project's styling approach and file layout. Add a test or story for the main states.

## Watch out for
- `useEffect` used to compute derived values.
- Index keys on lists that reorder.
- Giant components. Split out a part when it has its own state or reason to change.

## Output
The component, a usage example, and notes on its props.
