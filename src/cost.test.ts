// src/cost.test.ts
import { describe, expect, test } from 'bun:test'
import { formatDuration, resolveRoot, subtreeCost, totalTokens, type SessionLike, type CostApi } from './cost.js'

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
  expect(result).toEqual({ totalCost: 2.5, subagentCost: 0, subagentCount: 0, partial: false, subagents: [] })
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
    subagentCost: 0.75,
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
    subagentCost: 0.75,
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
    subagentCost: 10.2,
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
    subagentCost: 0.5,
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

test('subtreeCost preserves agent, model, tokens, outcome, and time metadata on subagents', async () => {
  const api = makeApi(
    { ses_root: { id: 'ses_root', cost: 1 } },
    {
      ses_root: [
        {
          id: 'ses_child',
          title: 'Audit API',
          cost: 0.03286,
          agent: 'explore',
          model: { providerID: 'anthropic', id: 'claude-sonnet-4-5', variant: 'high' },
          outcome: 'succeeded',
          tokens: { input: 120, output: 80, reasoning: 30, cache: { read: 1000, write: 200 } },
          time: { created: 1_000, updated: 15_400, idle: 15_200 },
        },
      ],
      ses_child: [],
    },
  )
  const result = await subtreeCost(api, 'ses_root')
  expect(result.subagents).toEqual([
    {
      id: 'ses_child',
      title: 'Audit API',
      cost: 0.03286,
      agent: 'explore',
      model: { providerID: 'anthropic', id: 'claude-sonnet-4-5', variant: 'high' },
      outcome: 'succeeded',
      tokens: { input: 120, output: 80, reasoning: 30, cache: { read: 1000, write: 200 } },
      time: { created: 1_000, updated: 15_400, idle: 15_200 },
    },
  ])
})

test('totalTokens sums input, output, reasoning, and cache read/write tokens', () => {
  expect(totalTokens(undefined)).toBe(0)
  expect(
    totalTokens({
      input: 100,
      output: 50,
      reasoning: 25,
      cache: { read: 400, write: 125 },
    }),
  ).toBe(700)
})

test('formatDuration formats sub-second, second, and minute durations from created to idle/updated', () => {
  expect(formatDuration(undefined)).toBeUndefined()
  expect(formatDuration({ created: 5_000, updated: 4_000 })).toBeUndefined()
  expect(formatDuration({ created: 1_000, updated: 1_400 })).toBe('<1s')
  expect(formatDuration({ created: 1_000, updated: 99_000, idle: 13_400 })).toBe('12s')
  expect(formatDuration({ created: 0, updated: 89_000 })).toBe('1m 29s')
})
