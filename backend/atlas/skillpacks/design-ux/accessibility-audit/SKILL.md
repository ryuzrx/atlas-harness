---
name: accessibility-audit
description: Check an interface against accessibility basics.
---

Use this to check an interface against accessibility basics (WCAG 2.2 AA).

## Steps
1. Keyboard: can you reach and use everything with Tab, Enter, Space and Esc? Is focus always visible, and does it move in a sensible order?
2. Screen readers: does every control have an accessible name? Are images given alt text (or marked decorative)? Are headings and landmarks in a sensible order?
3. Contrast: body text at least 4.5:1, large text and UI parts at least 3:1, in light and dark themes.
4. Don't rely on colour alone. Errors and states also need text or an icon.
5. Motion and timing: respect reduced motion, no auto-playing content you can't stop, no tight time limits.
6. Forms: labels tied to inputs, errors explained next to the field, nothing cleared when an error shows.
7. Zoom: still usable at 200% zoom and on a 320px-wide screen.

## Output
Issues grouped by severity, each with where it is, who it affects, the WCAG criterion, and the fix.
