/** @jsxImportSource @opentui/solid */
import { createMemo, createResource, createSignal, onCleanup } from "solid-js"
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
      const result = await api.client.session.children({ sessionID: id })
      const list = result.data
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

  const unsubscribeIdle = props.api.event.on("session.idle", () => setRefreshToken((n) => n + 1))
  const unsubscribeUpdated = props.api.event.on("session.updated", () => setRefreshToken((n) => n + 1))
  const unsubscribeCreated = props.api.event.on("session.created", () => setRefreshToken((n) => n + 1))
  onCleanup(() => {
    unsubscribeIdle()
    unsubscribeUpdated()
    unsubscribeCreated()
  })

  const source = createMemo(() => ({
    id: resolveRoot(makeCostApi(props.api), props.session_id),
    refresh: refreshToken(),
  }))

  const [result] = createResource(source, async ({ id }) => subtreeCost(makeCostApi(props.api), id))

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
