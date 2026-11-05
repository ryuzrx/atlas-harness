---
name: cron-schedule
description: Schedule recurring jobs correctly.
---

Use this to schedule recurring jobs correctly.

## Steps
1. Write the schedule as five fields (minute, hour, day of month, month, day of week) and say in plain words when it runs. Check the server's time zone.
2. Use absolute paths. Set PATH and the environment variables inside the script, because cron has a minimal environment.
3. Redirect output to a log (`>> /var/log/job.log 2>&1`), or send failure alerts.
4. Stop overlapping runs with `flock -n`.
5. Make the job safe to run twice, and safe to run again after a failure.
6. On systemd hosts, consider a systemd timer instead (better logs, catch-up runs).

## Output
The crontab line or timer unit, the script wrapper, and how to check that it ran.
