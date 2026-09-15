---
name: handoff
description: Continue the current thread in a fresh one with `bb handoff`. Use when the context window is nearly full, the conversation has drifted, or the user asks to hand off or continue in a new thread.
---

# Ultra Topbar

`bb handoff` starts a new thread in the same project and environment whose
first message is `Continue from @thread:<this thread>`. The agent there reads
this thread's transcript with `bb thread log` and picks the work up on a clean
context window.

## Commands

| Command | Effect |
| --- | --- |
| `bb handoff` | Hand off the current thread. |
| `bb handoff <thread-id>` | Hand off another thread. |
| `bb handoff --dry-run` | Print the resolved project, environment, agent, and message without creating a thread. |
| `bb handoff --json` | Machine-readable `{ sourceThreadId, threadId }`. |

## Outcomes

- Exit 0 with `Handed off <source> to <new-thread-id>`.
- Exit 1 with a one-line reason: the source thread could not be read or the
  new thread could not be created. Report it; do not retry in a loop.
- Exit 2 with usage: no thread id and not running inside a thread.

## Rules

- Before handing off, write down anything the successor cannot recover from
  the transcript: decisions, open questions, and exactly where the work stands.
- Hand off once. The successor is a peer, not a child: it does not report back.
- After handing off, tell the user the new thread id and stop working here.

To hand off to another agent, pass `--provider PROVIDER-ID --model MODEL-ID` together. Models are validated on the source machine. The selected model uses its default reasoning level and destination permission/service defaults. `--dry-run` validates without creating a successor.

## Pull request toolbar

The header also opens a fresh New thread composer and a PR review.
Use `bb handoff pr status [thread-id]` to inspect an existing PR, or
`bb handoff pr preview [thread-id]` to generate a review from branch commits.
`bb handoff pr create '<review-json>' [thread-id]` pushes and publishes; JSON
requires branch, sha, base, title, body, and draft. Only run create when the user
has authorized publishing that PR. The UI provides the same review and submission.
