# Contributing to opencode-session-cost

Thanks for your interest in contributing. This document describes how to set
up the project, the standards we follow, and how to submit changes.

## Ways to contribute

- Report bugs by opening an [issue](https://github.com/igorvelho/opencode-session-cost/issues).
- Propose features or behavior changes via an issue before opening a large PR.
- Improve documentation.
- Submit bug fixes or features via a pull request.

## Development setup

This project uses [Bun](https://bun.sh) for development, tests, and building.

```bash
git clone https://github.com/igorvelho/opencode-session-cost.git
cd opencode-session-cost
bun install
```

### Common commands

```bash
bun test            # run the test suite
bun run typecheck   # type-check without emitting (tsc --noEmit)
bun run build       # bundle src/tui.tsx with Bun.build + @opentui/solid/bun-plugin,
                     # then emit .d.ts files with tsc --emitDeclarationOnly
```

All three must pass before a change is merged. `prepublishOnly` runs the same
gate automatically before publishing.

### Trying a local checkout in OpenCode

Point your `tui.json` at the checkout directory instead of the npm package
while iterating:

```json
{
  "plugin": [["/absolute/path/to/opencode-session-cost", { "enabled": true }]]
}
```

Run `bun run build` after every change and restart the OpenCode TUI to pick
it up — there is no watch/hot-reload mode.

## Coding standards

- **Language:** TypeScript in `strict` mode. Do not weaken `tsconfig.json`
  strictness or add `// @ts-ignore` / `any` to bypass the type checker unless
  there is a documented reason.
- **Separation of concerns:** Keep `src/cost.ts` free of `@opentui`/Solid/JSX
  imports. It must stay pure and unit-testable in isolation — all
  OpenCode/Solid/rendering wiring belongs in `src/tui.tsx`.
- **No network calls beyond the local server:** This plugin reads only from
  OpenCode's own local session state and its local TUI-to-server API
  (`api.client`). Do not add calls to any external service, gateway, or
  provider API.
- **No provider-specific behavior:** The cost total must work identically
  regardless of which model or provider a session used. Do not add
  provider allow-lists or provider-specific branching.
- **Style:** Match the existing style in `src/` — 2-space indentation, no
  semicolons where the surrounding code omits them.

## Tests

- Every behavioral change to `src/cost.ts` needs test coverage. Tests live in
  `src/cost.test.ts` and run with `bun test`.
- Tests exercise `resolveRoot`/`subtreeCost` against a fake `CostApi` — do not
  add a dependency on a real OpenCode server or `@opentui`/Solid rendering to
  test this logic.
- Cover edge cases explicitly: no parent, multi-level chains, cyclic
  chains, zero children, shared/duplicate descendants, and partial failures
  (a rejected `getChildren` call).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) — this
repository uses [semantic-release](https://semantic-release.gitbook.io/),
so commit type determines the next published version:

```
feat: add X       # minor release
fix: correct Y     # patch release
docs: clarify Z     # no release
chore: tidy build config   # no release
test: cover edge case      # no release
```

A breaking change (`feat!:` or a `BREAKING CHANGE:` footer) triggers a major
release. Keep commits focused and self-contained.

## Pull request process

1. Fork the repository and create a branch from `main`.
2. Make your change, adding or updating tests as needed.
3. Run `bun test`, `bun run typecheck`, and `bun run build` locally.
4. Update the [README](README.md) if you change configuration options or
   behavior.
5. Open a pull request with a clear description of the change and its
   motivation. Link any related issue.
6. Be responsive to review feedback. CI (`bun run typecheck`, `bun test`,
   `bun run build`) must be green before merge.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) that covers this project.
