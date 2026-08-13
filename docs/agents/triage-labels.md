# Triage Labels

This repo uses the five canonical triage labels as-is:

| Label             | Meaning                                  |
| ----------------- | ---------------------------------------- |
| `needs-triage`    | Maintainer needs to evaluate this issue  |
| `needs-info`      | Waiting on reporter for more information |
| `ready-for-agent` | Fully specified, ready for an AFK agent  |
| `ready-for-human` | Requires human implementation            |
| `wontfix`         | Will not be actioned                     |

When a skill mentions a triage role (e.g. "apply the AFK-ready triage label"), the label string is the role name itself. If this repo's tracker ever adopts different label names, turn this list into a role → label mapping so `/triage` applies existing labels instead of creating duplicates.
