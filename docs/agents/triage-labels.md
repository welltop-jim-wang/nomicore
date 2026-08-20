# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Task-type labels (orthogonal to triage roles)

| Task type | Label | Meaning |
| --------- | ----- | ------- |
| bug       | `bug` | Fix a defect / restore broken behaviour |
| feature   | `feature` | Add new capability |
| refactor  | `refactor` | Restructure without behaviour change |

- Every agent-grabbable ticket gets **exactly one** task-type label.
- A ticket that belongs to none of the three (research, docs, discussion, ...)
  gets **no task-type label**, and its body omits the `## Task Type` section —
  the orchestrator judges the type itself.
- Never invent additional task-type labels.

Edit the right-hand column to match whatever vocabulary you actually use.

