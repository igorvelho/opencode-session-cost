# opencode-session-cost

[![npm version](https://img.shields.io/npm/v/opencode-session-cost.svg)](https://www.npmjs.com/package/opencode-session-cost)
[![CI](https://github.com/igorvelho/opencode-session-cost/actions/workflows/ci.yml/badge.svg)](https://github.com/igorvelho/opencode-session-cost/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Do you know how much you're really spending on a session? Subagent costs
hide from you by default in [OpenCode](https://opencode.ai). This plugin
adds a sidebar block showing your true total — session + every subagent it
spawned — and lets you expand it to see the cost of each one.

![Total Session Cost sidebar block showing total cost and subagent count](docs/assets/session-cost-sidebar.png)

## Installation

This is a **TUI-only** plugin. It has no server-side hook and must be added
to `tui.json`, not `opencode.json`.

### Quick install (recommended)

Run this from a terminal — it installs the package and adds it to your
global `tui.json` automatically:

```bash
opencode plugin opencode-session-cost --global
```

Restart the OpenCode TUI afterwards for the sidebar block to appear.

### Manual install

Add this to `tui.json` yourself instead:

```json
{
  "plugin": [["opencode-session-cost", { "enabled": true }]]
}
```

Using a local checkout instead of the npm package? Point at the directory:

```json
{
  "plugin": [
    ["/absolute/path/to/opencode-session-cost", { "enabled": true }]
  ]
}
```

Restart the OpenCode TUI after editing `tui.json`.

### Options

| Option    | Type    | Default | Description                                                          |
| --------- | ------- | ------- | ---------------------------------------------------------------------|
| `enabled` | boolean | `true`  | When `false`, the plugin's `tui()` returns immediately and registers nothing. |

There is no provider allow-list and no other configuration — this works
for every session regardless of model or provider.

## Development

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # bun:test, pure logic in src/cost.test.ts
bun run build        # Bun.build (JSX) + tsc --emitDeclarationOnly (types)
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
development setup, coding standards, and the pull request process.

## License

MIT — see [LICENSE](LICENSE).
