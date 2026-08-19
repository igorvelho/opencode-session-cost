# OpenCode Session Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone OpenCode TUI plugin that always shows, in the sidebar, the total cost of the active session plus all its subagent (task) sessions — using only OpenCode's own local session data, with no gateway or provider-specific dependency.

**Architecture:** A new package, `opencode-session-cost`, registers a `sidebar_content` TUI slot. Pure functions (`resolveRoot`, `subtreeCost`) walk `session.parentID` to find the root session and recursively sum `session.cost` across the root and its descendants via `client.session.children`. A thin Solid.js view wraps that logic, recomputing on session lifecycle events and rendering total cost plus subagent count.

**Tech Stack:** TypeScript, `@opencode-ai/plugin/tui`, `@opentui/solid`, Solid.js, Bun test runner, Bun/`tsc` build.

## Global Constraints

- Package is fully independent of `opencode-session-correlation` — no shared imports, no shared config, no runtime dependency in either direction.
- TUI-only plugin target: `package.json` `exports` must expose only `./tui`; no `main`/`exports["./server"]` (a module cannot export both `server` and `tui` per the OpenCode plugin loader).
- No network calls beyond the local OpenCode server the TUI already talks to via `api.client`.
- Core cost-calculation logic (`resolveRoot`, `subtreeCost`) must be pure and testable without importing `@opentui/solid`/JSX, matching the existing `opencode-session-correlation` pattern of separating logic (`src/index.ts`) from wiring.
- Match `opencode-session-correlation`'s existing tooling conventions: `bun test`, `tsc --noEmit` for typecheck, `tsc` for build, strict TypeScript, ES2022/NodeNext module target.
- Max parent-chain walk depth: 50 (matches `MAX_PARENT_CHAIN_DEPTH` convention in `opencode-session-correlation/src/index.ts:53`), to defend against cyclic/pathological data without hanging.
- Sidebar block `order: 150` — between the built-in Context block (`order: 100`) and MCP block (`order: 200`).

## Task 1: Scaffold Package And Prove Pure Cost Logic

**Files:**
- Create: `/home/velhoi/repo/opencode-session-cost/package.json`
- Create: `/home/velhoi/repo/opencode-session-cost/tsconfig.json`
- Create: `/home/velhoi/repo/opencode-session-cost/src/cost.ts`
- Create: `/home/velhoi/repo/opencode-session-cost/src/cost.test.ts`

**Step 1: Write the failing tests**

```ts
// src/cost.test.ts
import { describe, expect, test } from 'bun:test'
import { resolveRoot, subtreeCost, type SessionLike, type CostApi } from './cost.js'

function makeApi(sessions: Record<string, SessionLike>, children: Record<string, SessionLike[]>): CostApi {
  return {
    getSession: (id) => sessions[id],
    getChildren: async (id) => children[id] ?? [],
  }
}

test('resolveRoot returns the input id when there is no parent', () => {
  const api = makeApi({ ses_a: { id: 'ses_a', cost: 1 } }, {})
  expect(resolveRoot(api, 'ses_a')).toBe('ses_a')
})

test('resolveRoot walks up multiple parent levels', () => {
  const api = makeApi(
    {
      ses_root: { id: 'ses_root', cost: 1 },
      ses_mid: { id: 'ses_mid', cost: 1, parentID: 'ses_root' },
      ses_leaf: { id: 'ses_leaf', cost: 1, parentID: 'ses_mid' },
    },
    {},
  )
  expect(resolveRoot(api, 'ses_leaf')).toBe('ses_root')
})

test('resolveRoot stops at max depth on a cyclic chain instead of looping forever', () => {
  const api = makeApi(
    {
      ses_a: { id: 'ses_a', cost: 0, parentID: 'ses_b' },
      ses_b: { id: 'ses_b', cost: 0, parentID: 'ses_a' },
    },
    {},
  )
  expect(resolveRoot(api, 'ses_a')).toBe('ses_a')
})

test('subtreeCost sums root cost with zero children', async () => {
  const api = makeApi({ ses_root: { id: 'ses_root', cost: 2.5 } }, { ses_root: [] })
  const result = await subtreeCost(api, 'ses_root')
  expect(result).toEqual({ totalCost: 2.5, subagentCount: 0, partial: false })
})

test('subtreeCost sums root plus flat children', async () => {
  const api = makeApi(
    { ses_root: { id: 'ses_root', cost: 1 } },
    {
      ses_root: [
        { id: 'ses_child_1', cost: 0.5 },
        { id: 'ses_child_2', cost: 0.25 },
      ],
      ses_child_1: [],
      ses_child_2: [],
    },
  )
  const result = await subtreeCost(api, 'ses_root')
  expect(result).toEqual({ totalCost: 1.75, subagentCount: 2, partial: false })
})

test('subtreeCost sums a multi-level tree', async () => {
  const api = makeApi(
    { ses_root: { id: 'ses_root', cost: 1 } },
    {
      ses_root: [{ id: 'ses_child', cost: 0.5 }],
      ses_child: [{ id: 'ses_grandchild', cost: 0.25 }],
      ses_grandchild: [],
    },
  )
  const result = await subtreeCost(api, 'ses_root')
  expect(result).toEqual({ totalCost: 1.75, subagentCount: 2, partial: false })
})

test('subtreeCost does not double-count a session reachable via two paths', async () => {
  const shared = { id: 'ses_shared', cost: 10 }
  const api = makeApi(
    { ses_root: { id: 'ses_root', cost: 1 } },
    {
      ses_root: [
        { id: 'ses_a', cost: 0.1 },
        { id: 'ses_b', cost: 0.1 },
      ],
      ses_a: [shared],
      ses_b: [shared],
      ses_shared: [],
    },
  )
  const result = await subtreeCost(api, 'ses_root')
  expect(result).toEqual({ totalCost: 1.2, subagentCount: 2, partial: false })
})

test('subtreeCost returns partial result and partial: true when a child fetch rejects', async () => {
  const api: CostApi = {
    getSession: (id) => ({ id, cost: id === 'ses_root' ? 1 : 0.5 }),
    getChildren: async (id) => {
      if (id === 'ses_root') return [{ id: 'ses_child', cost: 0.5 }]
      throw new Error('network error')
    },
  }
  const result = await subtreeCost(api, 'ses_root')
  expect(result).toEqual({ totalCost: 1.5, subagentCount: 1, partial: true })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/cost.test.ts` (from `/home/velhoi/repo/opencode-session-cost`)

Expected: FAIL because `./cost.js` does not exist.

**Step 3: Add package configuration**

```json
{
  "name": "opencode-session-cost",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.17.18",
    "@types/bun": "latest",
    "typescript": "^5.7.3"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "declaration": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["node", "bun"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

**Step 4: Implement minimal cost logic**

In `src/cost.ts`, define and export:

```ts
export type SessionLike = {
  id: string
  cost: number
  parentID?: string
}

export type CostApi = {
  getSession: (id: string) => SessionLike | undefined
  getChildren: (id: string) => Promise<SessionLike[]>
}

export type SubtreeCostResult = {
  totalCost: number
  subagentCount: number
  partial: boolean
}
```

- `resolveRoot(api: CostApi, sessionId: string): string` — iteratively follow `.parentID` via `api.getSession`, bounded by `MAX_PARENT_CHAIN_DEPTH = 50`; return the last resolvable id (input id itself if it has no parent, on cycle detection, or if depth limit reached).
- `subtreeCost(api: CostApi, rootId: string): Promise<SubtreeCostResult>` — depth-first walk starting at `rootId` using a `Set<string>` of visited ids to prevent double-counting; total cost starts from `api.getSession(rootId)?.cost ?? 0`; for each visited node, call `api.getChildren(id)`, add each returned child's `.cost` once (skip children already in the visited set), and recurse into each newly-visited child's children; if `api.getChildren` throws for any node, catch it, stop descending from that node, and set `partial: true` on the final result while keeping everything already accumulated.

**Step 5: Run tests to verify they pass**

Run: `bun test src/cost.test.ts`

Expected: PASS for all 7 tests.

**Step 6: Run typecheck**

Run: `bun run typecheck`

Expected: exits 0.

**Step 7: Commit**

```bash
cd /home/velhoi/repo/opencode-session-cost
git init -q
git add package.json tsconfig.json src/cost.ts src/cost.test.ts
git commit -m "feat: add pure session cost aggregation logic"
```

## Task 2: Wire Cost Logic Into A TUI Plugin Entrypoint

**Files:**
- Create: `/home/velhoi/repo/opencode-session-cost/src/tui.tsx`
- Modify: `/home/velhoi/repo/opencode-session-cost/package.json`
- Modify: `/home/velhoi/repo/opencode-session-cost/tsconfig.json`

**Interfaces:**
- Consumes: `resolveRoot(api: CostApi, sessionId: string): string` and `subtreeCost(api: CostApi, rootId: string): Promise<SubtreeCostResult>` from Task 1's `src/cost.ts`.
- Produces: default export `plugin: TuiPluginModule` with `{ id: "opencode-session-cost", tui }`, consumed by OpenCode's TUI plugin loader when referenced from `tui.json`.

**Step 1: Add TUI dependencies and exports to package.json**

Update `package.json`:

```json
{
  "name": "opencode-session-cost",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tui": {
      "import": "./dist/tui.js"
    }
  },
  "engines": {
    "opencode": "^1.18.0"
  },
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.17.18",
    "@opentui/core": "^0.1.0",
    "@opentui/solid": "^0.1.0",
    "@types/bun": "latest",
    "typescript": "^5.7.3"
  }
}
```

Run `bun install` in `/home/velhoi/repo/opencode-session-cost` after this edit to confirm `@opentui/core`/`@opentui/solid` resolve to actual published versions available in the registry; if the pinned `^0.1.0` range does not resolve, use whatever version `bun add @opentui/solid @opentui/core --dev` installs and update `package.json` to match the resolved versions exactly.

**Step 2: Update tsconfig for JSX**

Add to `tsconfig.json` `compilerOptions`:

```json
"jsx": "preserve",
"jsxImportSource": "@opentui/solid"
```

**Step 3: Implement the TUI entrypoint**

In `src/tui.tsx`:

```tsx
/** @jsxImportSource @opentui/solid */
import { createMemo, createResource, createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { resolveRoot, subtreeCost, type CostApi, type SessionLike } from "./cost.js"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

function toSessionLike(session: { id: string; cost?: number; parentID?: string } | undefined): SessionLike | undefined {
  if (!session) return undefined
  return { id: session.id, cost: session.cost ?? 0, parentID: session.parentID }
}

function makeCostApi(api: TuiPluginApi): CostApi {
  return {
    getSession: (id) => toSessionLike(api.state.session.get(id)),
    getChildren: async (id) => {
      const result = await api.client.session.children({ path: { id } })
      const list = (result as { data?: unknown }).data
      if (!Array.isArray(list)) return []
      return list
        .map((item) => toSessionLike(item as { id: string; cost?: number; parentID?: string }))
        .filter((item): item is SessionLike => item !== undefined)
    },
  }
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [refreshToken, setRefreshToken] = createSignal(0)
  const theme = () => props.api.theme.current

  props.api.event.on("session.idle", () => setRefreshToken((n) => n + 1))
  props.api.event.on("session.updated", () => setRefreshToken((n) => n + 1))
  props.api.event.on("session.created", () => setRefreshToken((n) => n + 1))

  const rootId = createMemo(() => {
    refreshToken()
    return resolveRoot(makeCostApi(props.api), props.session_id)
  })

  const [result] = createResource(rootId, async (id) => subtreeCost(makeCostApi(props.api), id))

  return (
    <box>
      <text fg={theme().text}>
        <b>Session Cost</b>
      </text>
      <text fg={theme().textMuted}>
        {result() ? money.format(result()!.totalCost) : money.format(0)} total
        {result()?.partial ? " (stale)" : ""}
      </text>
      {result() && result()!.subagentCount > 0 ? (
        <text fg={theme().textMuted}>{result()!.subagentCount} subagent session(s)</text>
      ) : null}
    </box>
  )
}

const tui: TuiPlugin = async (api, options) => {
  if (options && (options as { enabled?: boolean }).enabled === false) return

  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-session-cost",
  tui,
}

export default plugin
```

**Step 4: Run typecheck**

Run: `bun run typecheck`

Expected: exits 0. If `@opencode-ai/plugin/tui` types are unavailable in the installed `@opencode-ai/plugin` version, bump the `devDependencies` version pin to the lowest version that exports `TuiPlugin`/`TuiPluginApi`/`TuiPluginModule` from `@opencode-ai/plugin/tui`, matching whatever is installed at `/home/velhoi/.config/opencode/node_modules/@opencode-ai/plugin`.

**Step 5: Run build**

Run: `bun run build`

Expected: exits 0, produces `dist/tui.js` and `dist/cost.js`.

**Step 6: Commit**

```bash
git add package.json tsconfig.json src/tui.tsx bun.lock
git commit -m "feat: add TUI sidebar entrypoint for session cost"
```

## Task 3: Manual Integration Verification With Live OpenCode

**Files:**
- Modify: `/home/velhoi/.config/opencode/tui.json`

**Step 1: Add local plugin configuration**

Read the current `tui.json` first (it may not exist yet — if absent, create it with `$schema` and an empty `plugin` array before adding the entry). Add this array element to the `plugin` array:

```json
["/home/velhoi/repo/opencode-session-cost", { "enabled": true }]
```

**Step 2: Restart OpenCode's TUI**

Quit and restart the OpenCode TUI so it loads the updated `tui.json`.

**Step 3: Verify the plugin loads**

Open the command palette (`ctrl+p`) and check the plugin list, or inspect TUI debug/plugin-status output if available, for `opencode-session-cost` in an `active: true` state.

Expected: plugin appears loaded with no activation error.

**Step 4: Verify sidebar rendering with zero subagents**

Start a new session, send one prompt, wait for it to finish.

Expected: sidebar shows a "Session Cost" block directly below "Context", with a non-zero dollar total matching (or very close to, allowing for a currently-in-flight message) the built-in Context block's "$X spent" line, and no "subagent session(s)" line.

**Step 5: Verify sidebar rendering with subagents**

In the same or a new session, dispatch two subagents via the `task` tool. Wait for both to complete.

Expected: sidebar's "Session Cost" total increases to reflect the root session's own cost plus both subagent sessions' costs, and the line "2 subagent session(s)" appears.

**Step 6: Cross-check against the SDK directly**

Run a one-off script (or use `bun run` inline) that calls `client.session.get` for the root and each subagent session ID (visible via OpenCode TUI logs or `client.session.children`) and sums their `.cost` fields manually.

Expected: manually computed sum matches the sidebar's displayed total to the displayed precision (4 decimal places).

**Step 7: Verify no server-side plugin entry is required**

Confirm `/home/velhoi/.config/opencode/opencode.json`'s `plugin` array has no entry referencing `opencode-session-cost`.

Expected: true — the feature works from the `tui.json` entry alone.

**Step 8: Commit configuration change**

```bash
cd /home/velhoi/.config/opencode
git add tui.json
git commit -m "feat: enable opencode-session-cost TUI plugin"
```

If `/home/velhoi/.config/opencode` is not a git repository, skip this step and note the manual `tui.json` change instead.

## Task 4: Document The Plugin

**Files:**
- Create: `/home/velhoi/repo/opencode-session-cost/README.md`

**Step 1: Write the README**

Document:

- What the plugin does: shows total cost of the active session plus all subagent sessions, always visible in the sidebar, using only OpenCode's own tracked `session.cost` — no gateway, no network calls, works with any provider.
- Installation/config:
  ```json
  {
    "plugin": [
      ["/absolute/path/to/opencode-session-cost", { "enabled": true }]
    ]
  }
  ```
  placed in `tui.json`, not `opencode.json`.
- The `enabled` option (default `true`).
- How refresh works: recomputes on `session.idle`/`session.updated`/`session.created`, no polling.
- What "subagent session(s)" counts: every session reachable from the root via `parentID`, i.e. every `task` tool dispatch in the session tree, at any depth.
- Explicitly state the relationship to `opencode-session-correlation`: none — fully independent packages, no shared code or config, can be installed together or separately.

**Step 2: Commit**

```bash
cd /home/velhoi/repo/opencode-session-cost
git add README.md
git commit -m "docs: document opencode-session-cost plugin"
```
