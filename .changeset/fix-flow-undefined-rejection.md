---
"tryharder": patch
---

Fix `flow` failing to surface tasks that throw `undefined`. The first rejection is now stored as its mapped (non-undefined) value, keeping `firstRejection !== undefined` a sound signal even when a task throws `undefined` (which maps to an `UnhandledException`).
