# OpenCode Session Cost Design

**Goal:** Show, always visible in the OpenCode TUI sidebar, the total cost of the active session including all its subagent (task) sessions — using only OpenCode's own local session data, so it works with any provider/gateway with no external network calls.

**Architecture:** A standalone OpenCode TUI plugin registers a `sidebar_content` slot. On render (and on relevant session events) it walks the current session's `parentID` chain to find the root session, then recursively sums `session.cost` across the root and all of its descendant sessions (subagents spawned via the `task` tool), using OpenCode's existing local session state and the `session.children` API. No gateway, no correlation header, no HTTP calls outside the local OpenCode server.

**Tech Stack:** TypeScript, `@opencode-ai/plugin/tui`, `@opentui/solid` (JSX), Solid.js reactive primitives (`createResource`/`createMemo`), Bun for build/test.

## Scope

- New standalone package `opencode-session-cost`, independent of `opencode-session-correlation` (no shared code, no runtime dependency either direction).
- TUI-only plugin target (`exports["./tui"]`, no `exports["./server"]`/`main`).
- Pure, unit-testable core logic (`resolveRoot`, `subtreeCost`) separated from the Solid/JSX rendering layer.
- New sidebar block, always visible while a session is active, showing total cost across the session tree and subagent-session count.
- Refresh on session lifecycle events, plus manual refresh; no polling loop by default.
- Graceful degradation on missing data or API errors (stale-but-visible, never crash the sidebar).

## Non-goals

- No gateway/LiteLLM API calls of any kind — cost comes exclusively from OpenCode's own tracked `session.cost`.
- No dependency on `opencode-session-correlation`'s header/UUID mechanism.
- No historical cost reporting (today only / date-range queries) — this is a live "current session tree" figure only.
- No publishing to npm as part of this iteration (local path plugin, same as `opencode-session-correlation` today).
- No changes to how OpenCode itself computes or stores `session.cost` per model.

## Package Structure

```
opencode-session-cost/
├── src/
│   ├── cost.ts           # resolveRoot(), subtreeCost() — pure, no JSX/Solid import
│   ├── cost.test.ts      # unit tests against a fake minimal api surface
│   └── tui.tsx           # TuiPlugin entrypoint: slot registration + Solid view
├── package.json          # exports["./tui"] only; engines.opencode range
├── tsconfig.json
├── README.md
└── LICENSE
```

## Configuration

Added to `tui.json` only (this is a TUI plugin; it has no server-side hook and must not appear in `opencode.json`'s `plugin` array):

```json
{
  "plugin": [
    ["/absolute/path/to/opencode-session-cost", { "enabled": true }]
  ]
}
```

- `enabled` (optional, default `true`): when `false`, the plugin's `tui()` function returns immediately without registering anything.
- No other options. No provider allow-list — this works for every session regardless of model/provider, unlike `opencode-session-correlation`.

## Data Flow

1. Host renders the sidebar for the active `session_id` (prop supplied by the host's `sidebar_content` slot contract).
2. Plugin's Solid view resolves the **root session ID**:
   - `resolveRoot(api, sessionId)`: read `api.state.session.get(id)`; if `.parentID` is set, recurse on the parent; otherwise `id` is the root. Bounded by a max-depth guard (50, matching the correlation plugin's existing convention) to defend against any accidental cycle.
   - This step is pure local state access — no network, no async.
3. Plugin computes the **cost of the whole subtree** rooted at that ID:
   - `subtreeCost(api, rootId)`:
     a. Get the root's own info (`api.state.session.get(rootId)`, fallback to `api.client.session.get(rootId)` if not in local cache) → `total = info.cost ?? 0`.
     b. Fetch direct children via `api.client.session.children(rootId)` (SDK `client.session.children`).
     c. For each child, add its own `.cost` (already present on the returned child `Session.Info`, no extra fetch needed) and recurse into *its* children the same way, using a `Set<sessionId>` to guard against duplicate/cyclic traversal.
     d. Return the accumulated total plus the count of distinct sessions visited (root + all descendants) minus one, i.e. the subagent-session count.
4. Result `{ totalCost, subagentCount, sessionCount }` is rendered:
   ```
   Session Cost
   $1.0047 total
   4 subagent session(s)
   ```
5. Recomputation is triggered by:
   - `session.idle` (a turn just finished anywhere in the tree — cheap since it's a local fetch),
   - `session.created` / `session.updated` where the new/updated session's `parentID` resolves into the current tree,
   - a manual refresh command registered via `api.keymap.registerLayer` (e.g. slash command `/session-cost-refresh`),
   debounced (e.g. 300ms) so a burst of subagent creations doesn't cause redundant recomputation storms.
6. On any fetch error (e.g. `api.client.session.children` rejects), the view keeps the last successfully computed value and appends a muted "stale" indicator; it never throws out of the render.

## Rendering

- New block registered at `sidebar_content` with `order: 150` — placed immediately after the built-in Context block (`order: 100`, `internal:sidebar-context`) and before the MCP block (`order: 200`), matching the visual grouping in the current sidebar (Context → Session Cost → MCP → LSP).
- Uses the same theming pattern as `internal:sidebar-context` (`api.theme.current`, `text`/`textMuted` colors) and the same `Intl.NumberFormat` USD currency formatter for consistency with the existing "$X spent" line.
- Renders nothing (returns `null`) when there is no active session, matching how other sidebar blocks handle the no-session state.

## Validation

1. Unit test `resolveRoot`: returns the input ID when `parentID` is absent; walks up multiple levels; stops at `MAX_PARENT_CHAIN_DEPTH` on a pathological/cyclic chain instead of looping forever.
2. Unit test `subtreeCost`: sums root cost with zero children; sums root + N flat children; sums a multi-level tree (children with their own children); does not double-count a session reachable via two paths (defensive, even though the real session tree is a strict tree).
3. Unit test error handling: `api.client.session.children` rejecting for one node does not throw — the function returns the partial total computed so far plus a `partial: true` flag consumed by the view for the "stale" indicator.
4. Manual: start an OpenCode session, dispatch two `task` subagents, confirm the sidebar total equals the sum independently computed from `session.cost` via `client.session.get` for the root and both children.
5. Manual: confirm the block renders correctly with zero subagents (no "0 subagent session(s)" noise — omit that line when count is 0).
6. Manual: confirm no server-side plugin entry is required in `opencode.json` — the feature works purely from a `tui.json` plugin entry.
