---
name: analyze-csv
description: Explore a CSV or table and report what is in it.
---

Use this to explore a table and report what's in it.

## Steps
1. Load it and check its shape: the number of rows and columns, the column names and the inferred types.
2. Check quality: missing values per column, duplicates, odd values (negatives where there shouldn't be any, dates in the future), mixed types and units.
3. Describe it: counts and top values for categories; min, max, median and spread for numbers; the time range for dates.
4. Answer the user's actual question. If there isn't one, look for the 3 to 5 most notable patterns or relationships.
5. Back each finding with the number, and say how it was computed.

## Watch out for
- Claiming causation from correlation.
- Averages that hide skewed data. Report the median too.
- Silently dropping rows. Say how many you dropped and why.

## Output
A data overview, quality issues, key findings with numbers, suggested next steps, and the code you used.
