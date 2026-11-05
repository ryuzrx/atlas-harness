---
name: responsive-layout
description: Make a layout work on every screen size.
---

Use this to make a layout work at every screen size.

## Steps
1. Design mobile first: one column, then add layout as space grows.
2. Use fluid tools before breakpoints: `flex-wrap`, grid with `auto-fit` and `minmax()`, `clamp()` for type and spacing, and `max-width` for readable line lengths.
3. Add breakpoints where the content breaks, not at device widths.
4. Images: `max-width: 100%`, `srcset` and `sizes`, `aspect-ratio` to avoid layout shift.
5. Touch: tap targets of at least 44px, no hover-only controls.
6. Test at 320px, a tablet width, a wide desktop, and 200% zoom. Make sure there's no horizontal scrolling.

## Output
The CSS changes and a list of the widths you checked.
