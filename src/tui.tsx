/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { makeCostApi, refreshCost } from "./session-api.js"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function View(props: { api: Context; sessionID: string }) {
  const [refreshToken, setRefreshToken] = createSignal(0)
  const [expanded, setExpanded] = createSignal(false)
  const theme = () => props.api.theme

  const unsubscribe = props.api.data.listen(({ details }) => {
    if (["session.created", "session.deleted", "session.renamed", "session.usage.updated",
      "session.usage.recorded", "session.execution.succeeded", "session.execution.failed",
      "session.execution.interrupted"].includes(details.type)) setRefreshToken((n) => n + 1)
  })
  onCleanup(unsubscribe)

  const source = createMemo(() => ({
    id: props.api.data.session.root(props.sessionID),
    refresh: refreshToken(),
  }))

  const [result] = createResource(source, ({ id }) => {
    return refreshCost(makeCostApi({
      getSession: (sessionID) => props.api.data.session.get(sessionID),
      listSessions: (input) => props.api.client.session.list(input),
    }), id, () => props.api.data.session.sync(id))
  })

  return (
    <Show when={(result()?.subagentCount ?? 0) > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setExpanded((v) => !v)}>
          <text fg={theme().text.base}>{expanded() ? "▼" : "▶"}</text>
          <text fg={theme().text.base}>
            <b>Subagents</b>
            <span style={{ fg: theme().text.muted }}>
              {` (${result()!.subagentCount} · ${money.format(result()!.subagentCost)}${result()!.partial ? ", stale" : ""})`}
            </span>
          </text>
        </box>
        <Show when={expanded()}>
          <For each={result()!.subagents}>
            {(subagent) => (
              <box flexDirection="row" gap={1} minWidth={0}>
                <text flexShrink={0} fg={theme().text.muted}>
                  •
                </text>
                <text
                  fg={theme().text.base}
                  wrapMode="none"
                  truncate
                  flexGrow={1}
                  flexShrink={1}
                  minWidth={0}
                >
                  {subagent.title}
                </text>
                <text fg={theme().text.muted} wrapMode="none" flexShrink={0}>
                  {money.format(subagent.cost)}
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode-session-cost",
  setup(api) {
    if (api.options.enabled === false) return
    return api.ui.slot({
      append: "sidebar.content",
      render: (props) => <View api={api} sessionID={props.sessionID} />,
    })
  },
})
