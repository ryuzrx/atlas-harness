---
name: css-debugging
description: Find why a CSS rule is not applying.
---

Use this when a style isn't applying or the layout looks wrong.

## Steps
1. Inspect the element in DevTools. Is the rule there? Is it crossed out (overridden) or missing (selector doesn't match)?
2. If it's overridden, compare specificity and order. Check for `!important`, inline styles and a later stylesheet.
3. If it doesn't match, check the class name, the selector and the DOM structure (is it really a child?), and whether CSS modules or scoping renamed the class.
4. For layout, check `display`, the parent's flex or grid settings, `min-width: 0` on flex children, `position` and its containing block, and `overflow`.
5. For stacking problems, check z-index together with stacking contexts (transform, opacity, position, isolation).
6. Make a minimal test case if it's still unclear.

## Output
The cause, the fix, and why the fix works.
