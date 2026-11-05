---
name: web-performance
description: Speed up a slow web page with evidence.
---

Use this to speed up a slow page with evidence.

## Steps
1. Measure first with Lighthouse or WebPageTest, plus real-user data if it exists. Note LCP, INP, CLS and total transfer size.
2. For LCP, find the largest element. Optimise that image (modern format, right size, `fetchpriority="high"`), server response time, and render-blocking CSS and JS.
3. For INP, find long tasks. Split or defer JavaScript, and cut down third-party scripts.
4. For CLS, set sizes for images and embeds, reserve space for late content, and handle font swapping.
5. Cut bytes: compression, caching headers, code splitting, and removing unused CSS and JS.
6. Measure again after each change.

## Output
Baseline metrics, the changes ranked by impact, and the metrics after.
