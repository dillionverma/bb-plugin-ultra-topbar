Start the next thread. Review the PR. Keep the work moving. A compact topbar for BB threads.

## What you get

- **New thread.** Open a fresh composer in the current project.
- **Create PR.** Review an editable title, description, and base branch before publishing.
- **Draft or manual.** Create a draft or continue on GitHub’s compare page.
- **Pick up where you left off.** Continue in a fresh thread from the overflow menu. Existing PRs become View PR links.

## Requirements

Use the controls in a thread header. PR creation requires authenticated `gh`, a clean committed branch, and an origin remote matching the target GitHub repo. Publishing pushes the reviewed commit and creates the PR. Manual creation requires an already pushed branch.

`bb handoff --help` and `bb handoff pr --help` expose the same workflows.

## Source

[Source and installation](https://github.com/dillionverma/bb-plugin-ultra-topbar)
