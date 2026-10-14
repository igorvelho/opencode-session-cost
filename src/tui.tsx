/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { formatDuration, totalTokens, type SubagentCost } from "./cost.js"
import { makeCostApi, refreshCost } from "./session-api.js"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const exactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

function formatModel(model: SubagentCost["model"]): string {
  if (!model) return "—"
  const variant = model.variant && model.variant !== "default" ? `#${model.variant}` : ""
  return `${model.providerID}/${model.id}${variant}`
}

function DetailRow(props: { api: Context; label: string; value: string }) {
  const theme = () => props.api.theme
  return (
    <box flexDirection="row" justifyContent="space-between" gap={2}>
      <text fg={theme().text.muted} flexShrink={0}>
        {props.label}
      </text>
      <text fg={theme().text.base} wrapMode="none" truncate>
        {props.value}
      </text>
    </box>
  )
}

function SubagentDialog(props: { api: Context; subagents: SubagentCost[]; initialIndex: number }) {
  const [selectedIndex, setSelectedIndex] = createSignal(props.initialIndex)
  const theme = () => props.api.theme
  const current = () => props.subagents[selectedIndex()] ?? props.subagents[0]

  const openSession = () => {
    const item = current()
    if (!item) return
    props.api.ui.dialog.clear()
    props.api.ui.router.navigate({ type: "session", sessionID: item.id })
  }

  const prevSubagent = () => {
    if (props.subagents.length <= 1) return
    setSelectedIndex((i) => (i - 1 + props.subagents.length) % props.subagents.length)
  }

  const nextSubagent = () => {
    if (props.subagents.length <= 1) return
    setSelectedIndex((i) => (i + 1) % props.subagents.length)
  }

  props.api.keymap.layer(() => ({
    mode: "global",
    priority: 20,
    commands: [
      { bind: "return", run: openSession },
      { bind: "up", run: prevSubagent },
      { bind: "left", run: prevSubagent },
      { bind: "down", run: nextSubagent },
      { bind: "right", run: nextSubagent },
    ],
  }))

  return (
    <Show when={current()}>
      {(item) => {
        const live = () => props.api.data.session.get(item().id)
        const status = () => item().outcome ?? live()?.outcome ?? props.api.data.session.status(item().id)
        const duration = () => formatDuration(item().time ?? live()?.time) ?? "—"
        const tokens = () => item().tokens ?? live()?.tokens

        return (
          <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between" gap={2}>
              <text fg={theme().text.base} flexGrow={1} minWidth={0} wrapMode="none" truncate>
                <b>{item().title}</b>
              </text>
              <box flexDirection="row" gap={2} flexShrink={0}>
                <Show when={props.subagents.length > 1}>
                  <text fg={theme().text.muted}>
                    {`${selectedIndex() + 1}/${props.subagents.length}`}
                  </text>
                </Show>
                <text fg={theme().text.muted} onMouseUp={() => props.api.ui.dialog.clear()}>
                  esc
                </text>
              </box>
            </box>

            <box>
              <DetailRow api={props.api} label="Session ID" value={item().id} />
              <DetailRow api={props.api} label="Agent" value={item().agent ?? live()?.agent ?? "subagent"} />
              <DetailRow api={props.api} label="Model" value={formatModel(item().model ?? live()?.model)} />
              <DetailRow api={props.api} label="Status" value={status()} />
              <DetailRow api={props.api} label="Duration" value={duration()} />
            </box>

            <box>
              <text fg={theme().text.base}>
                <b>Cost & Tokens</b>
              </text>
              <DetailRow api={props.api} label="Cost" value={exactMoney.format(item().cost)} />
              <DetailRow api={props.api} label="Total tokens" value={totalTokens(tokens()).toLocaleString()} />
              <Show when={tokens()}>
                {(tok) => (
                  <>
                    <DetailRow
                      api={props.api}
                      label="Input / Output"
                      value={`${tok().input.toLocaleString()} in · ${tok().output.toLocaleString()} out`}
                    />
                    <DetailRow api={props.api} label="Reasoning" value={tok().reasoning.toLocaleString()} />
                    <DetailRow
                      api={props.api}
                      label="Cache"
                      value={`${tok().cache.read.toLocaleString()} read · ${tok().cache.write.toLocaleString()} write`}
                    />
                  </>
                )}
              </Show>
            </box>

            <box flexDirection="row" gap={3} flexWrap="wrap">
              <text onMouseUp={openSession}>
                <span style={{ fg: theme().text.base }}>
                  <b>enter</b>
                </span>
                <span style={{ fg: theme().text.muted }}> open session</span>
              </text>
              <Show when={props.subagents.length > 1}>
                <text onMouseUp={nextSubagent}>
                  <span style={{ fg: theme().text.base }}>
                    <b>↑/↓</b>
                  </span>
                  <span style={{ fg: theme().text.muted }}> switch subagent</span>
                </text>
              </Show>
              <text onMouseUp={() => props.api.ui.dialog.clear()}>
                <span style={{ fg: theme().text.base }}>
                  <b>esc</b>
                </span>
                <span style={{ fg: theme().text.muted }}> close</span>
              </text>
            </box>
          </box>
        )
      }}
    </Show>
  )
}

function openSubagentDialog(api: Context, subagents: SubagentCost[], index: number) {
  api.ui.dialog.set({ size: "medium", centered: true })
  api.ui.dialog.show(() => <SubagentDialog api={api} subagents={subagents} initialIndex={index} />)
}

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
            {(subagent, index) => (
              <box
                flexDirection="row"
                gap={1}
                minWidth={0}
                onMouseUp={() => openSubagentDialog(props.api, result()!.subagents, index())}
              >
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
