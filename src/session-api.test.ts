import { expect, test } from "bun:test"
import { makeCostApi, refreshCost } from "./session-api.js"
import { subtreeCost } from "./cost.js"

test("V2 child listing follows cursors and sums individual costs without double-counting", async () => {
  const root = { id: "root", cost: 1 }
  const child = { id: "child", parentID: "root", cost: 0.5, title: "Worker" }
  const grandchild = { id: "grandchild", parentID: "child", cost: 0.25 }
  const api = makeCostApi({
    getSession: (id) => id === "root" ? root : undefined,
    listSessions: async (input) => {
      if (input.cursor === "page2") return { data: [child, { id: "second", cost: 0.75 }], cursor: { next: null } }
      if (input.parentID === "root") return { data: [child], cursor: { next: "page2" } }
      if (input.parentID === "child") return { data: [grandchild], cursor: {} }
      return { data: [], cursor: {} }
    },
  })
  expect(await subtreeCost(api, "root")).toEqual({
    totalCost: 2.5,
    subagentCost: 1.5,
    subagentCount: 3,
    partial: false,
    subagents: [
      { id: "child", title: "Worker", cost: 0.5 },
      { id: "grandchild", title: "grandchild", cost: 0.25 },
      { id: "second", title: "second", cost: 0.75 },
    ],
  })
})

test("V2 pagination stops on an empty page even if the server returns a next cursor", async () => {
  let calls = 0
  const api = makeCostApi({
    getSession: () => undefined,
    listSessions: async () => {
      calls++
      if (calls > 1) throw new Error("empty pages must not be followed")
      return { data: [], cursor: { next: "empty" } }
    },
  })
  expect(await subtreeCost(api, "missing")).toEqual({
    totalCost: 0, subagentCost: 0, subagentCount: 0, partial: false, subagents: [],
  })
})

test("V2 listing failures produce a partial total rather than silently claiming completeness", async () => {
  const api = makeCostApi({
    getSession: () => ({ id: "root", cost: 2 }),
    listSessions: async () => { throw new Error("disconnected") },
  })
  expect(await subtreeCost(api, "root")).toEqual({
    totalCost: 2, subagentCost: 0, subagentCount: 0, partial: true, subagents: [],
  })
})

test("V2 repeated pagination cursors terminate with a partial result", async () => {
  const api = makeCostApi({
    getSession: () => ({ id: "root", cost: 2 }),
    listSessions: async () => ({ data: [{ id: "child", cost: 1 }], cursor: { next: "loop" } }),
  })
  expect(await subtreeCost(api, "root")).toEqual({
    totalCost: 2, subagentCost: 0, subagentCount: 0, partial: true, subagents: [],
  })
})

test("failed root synchronization keeps the cached total and reports it as partial", async () => {
  const api = makeCostApi({
    getSession: () => ({ id: "root", cost: 2 }),
    listSessions: async () => ({ data: [], cursor: {} }),
  })
  expect(await refreshCost(api, "root", async () => { throw new Error("offline") })).toEqual({
    totalCost: 2, subagentCost: 0, subagentCount: 0, partial: true, subagents: [],
  })
})
