---
name: bundle-size
description: Shrink a JavaScript bundle.
---

Use this to shrink a JavaScript bundle.

## Steps
1. Measure with a bundle analyser (for example `vite-bundle-visualizer`, `webpack-bundle-analyzer`, or `source-map-explorer`).
2. Find the biggest modules. Check for heavy libraries used for one function, duplicate versions, and polyfills you don't need.
3. Replace or trim them: import only what you need, swap in lighter alternatives, or use native APIs.
4. Split code by route and lazy-load heavy, rarely used features.
5. Make sure tree-shaking works: ES modules, `sideEffects` set correctly, no barrel files pulling everything in.
6. Measure again, and add a size budget in CI.

## Output
Before and after sizes, the changes ranked by bytes saved, and the budget config.
