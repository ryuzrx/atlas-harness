---
name: balance-tuning
description: Tune game balance with data.
---

Use this to tune game balance with data.

## Steps
1. Define the target experience: how long a session lasts, the win rate, the time to reach each milestone, and how hard it should feel.
2. Put every tunable number in one config table (damage, costs, drop rates, XP curves).
3. Collect data from playtests or telemetry: win and loss rates, which options get picked, where players quit, and how long things take.
4. Find the outliers: options that dominate, options nobody uses, difficulty spikes.
5. Change one variable at a time, in small steps (about 5 to 15%), and test again.
6. Keep a change log with the reason and the result for each change.

## Output
The problems you found (with numbers), the proposed changes, and the expected effect.
