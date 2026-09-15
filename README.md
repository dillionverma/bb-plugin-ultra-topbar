# Ultra Topbar

Start the next thread. Review the PR. Keep the work moving. A compact topbar for BB threads.

A plugin for [BB](https://getbb.app).

## Highlights

- **New thread.** Open a fresh composer in the current project.
- **Create PR.** Review an editable title, description, and base branch before publishing.
- **Draft or manual.** Create a draft or continue on GitHub’s compare page.
- **Pick up where you left off.** Continue in a fresh thread from the overflow menu. Existing PRs become View PR links.

## Install

```sh
bb plugin install https://github.com/dillionverma/bb-plugin-ultra-topbar
```

Requires BB 0.43+ and a compatible Plugin SDK (see `package.json`).

## Use

Use the controls in a thread header. PR creation requires authenticated `gh`, a clean committed branch, and an origin remote matching the target GitHub repo. Publishing pushes the reviewed commit and creates the PR. Manual creation requires an already pushed branch.

`bb handoff --help` and `bb handoff pr --help` expose the same workflows.

## Designed to stay responsive

PR status refreshes on focus and once per minute. Git operations run on the machine that owns the checkout. Review data is generated from commit subjects; no separate model call is required.

## Development

```sh
npm ci
npm run typecheck
npm test
bb plugin build .
```

Focused fixes and reproducible bug reports are welcome. Include BB version, platform, and steps to reproduce.

## Compatibility

The repository and display name are independent of BB’s persistent plugin identity. The internal ID remains `handoff` so existing settings, stored data, CLI commands, and integrations continue to work.

## The Ultra suite

Built for getting work done across multiple threads, agents, and projects. Install only the pieces you need.

- [Ultra Sidebar](https://github.com/dillionverma/bb-plugin-ultra-sidebar) — Organize parallel work.
- [Ultra Launcher](https://github.com/dillionverma/bb-plugin-ultra-launcher) — Start the next run.
- [Linear Panel](https://github.com/dillionverma/bb-plugin-linear-panel) — Keep issues beside execution.
- [Usage Window](https://github.com/dillionverma/bb-plugin-usage-window) — Keep account capacity in view.

## License

MIT. See [LICENSE](LICENSE).
