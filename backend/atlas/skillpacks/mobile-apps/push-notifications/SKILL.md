---
name: push-notifications
description: Design useful push notifications.
---

Use this to design notifications people won't turn off.

## Steps
1. Only send what's timely and personal, and that the user would want. Each type of notification needs a clear reason.
2. Ask for permission in context, after showing the value, never at first launch.
3. Write them short and specific ("Sam replied to your comment"), with a deep link to the exact screen.
4. Let users choose categories (iOS categories, Android channels). Respect quiet hours and limit how often you send.
5. Handle tokens: register, refresh, remove when invalid. Send through APNs or FCM from a server.
6. Measure opens and opt-outs for each type, and remove the types that annoy people.

## Output
The notification types (trigger, text, deep link), the permission flow, and the technical setup.
