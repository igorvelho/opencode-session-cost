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
  expect(result).toEqual({ totalCost: 2.5, subagentCount: 0, partial: false, subagents: [] })
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
  expect(result).toEqual({
    totalCost: 1.75,
    subagentCount: 2,
    partial: false,
    subagents: [
      { id: 'ses_child_1', title: 'ses_child_1', cost: 0.5 },
      { id: 'ses_child_2', title: 'ses_child_2', cost: 0.25 },
    ],
  })
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
  expect(result).toEqual({
    totalCost: 1.75,
    subagentCount: 2,
    partial: false,
    subagents: [
      { id: 'ses_child', title: 'ses_child', cost: 0.5 },
      { id: 'ses_grandchild', title: 'ses_grandchild', cost: 0.25 },
    ],
  })
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
  expect(result).toEqual({
    totalCost: 11.2,
    subagentCount: 3,
    partial: false,
    subagents: [
      { id: 'ses_a', title: 'ses_a', cost: 0.1 },
      { id: 'ses_shared', title: 'ses_shared', cost: 10 },
      { id: 'ses_b', title: 'ses_b', cost: 0.1 },
    ],
  })
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
  expect(result).toEqual({
    totalCost: 1.5,
    subagentCount: 1,
    partial: true,
    subagents: [{ id: 'ses_child', title: 'ses_child', cost: 0.5 }],
  })
})

test('subtreeCost uses session title when present, falling back to id otherwise', async () => {
  const api = makeApi(
    { ses_root: { id: 'ses_root', cost: 1 } },
    {
      ses_root: [
        { id: 'ses_named', cost: 0.5, title: 'Refactor auth middleware' },
        { id: 'ses_untitled', cost: 0.25 },
      ],
      ses_named: [],
      ses_untitled: [],
    },
  )
  const result = await subtreeCost(api, 'ses_root')
  expect(result.subagents).toEqual([
    { id: 'ses_named', title: 'Refactor auth middleware', cost: 0.5 },
    { id: 'ses_untitled', title: 'ses_untitled', cost: 0.25 },
  ])
})
