export type TokenUsageLike = {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

export type SessionModelLike = {
  id: string
  providerID: string
  variant?: string
}

export type SessionTimeLike = {
  created: number
  updated: number
  idle?: number
}

export type SessionLike = {
  id: string
  cost: number
  parentID?: string
  title?: string
  agent?: string
  model?: SessionModelLike
  tokens?: TokenUsageLike
  outcome?: "succeeded" | "failed" | "interrupted"
  time?: SessionTimeLike
}

export type CostApi = {
  getSession: (id: string) => SessionLike | undefined
  getChildren: (id: string) => Promise<SessionLike[]>
}

export type SubagentCost = {
  id: string
  title: string
  cost: number
  agent?: string
  model?: SessionModelLike
  tokens?: TokenUsageLike
  outcome?: "succeeded" | "failed" | "interrupted"
  time?: SessionTimeLike
}

export function totalTokens(tokens?: TokenUsageLike): number {
  if (!tokens) return 0
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function formatDuration(time?: SessionTimeLike): string | undefined {
  if (!time) return undefined
  const end = time.idle ?? time.updated
  const ms = end - time.created
  if (ms < 0) return undefined
  if (ms < 1_000) return "<1s"
  const totalSeconds = Math.round(ms / 1_000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export type SubtreeCostResult = {
  totalCost: number
  subagentCost: number
  subagentCount: number
  partial: boolean
  subagents: SubagentCost[]
}

const MAX_PARENT_CHAIN_DEPTH = 50

export function resolveRoot(api: CostApi, sessionId: string): string {
  let current = sessionId
  const visited = new Set<string>()

  for (let depth = 0; depth < MAX_PARENT_CHAIN_DEPTH; depth += 1) {
    if (visited.has(current)) return current
    visited.add(current)

    const session = api.getSession(current)
    if (!session?.parentID) return current

    current = session.parentID
  }

  return current
}

export async function subtreeCost(api: CostApi, rootId: string): Promise<SubtreeCostResult> {
  const visited = new Set<string>([rootId])
  const rootCost = api.getSession(rootId)?.cost ?? 0
  let subagentCost = 0
  let subagentCount = 0
  let partial = false
  const subagents: SubagentCost[] = []

  async function walk(id: string): Promise<void> {
    let children: SessionLike[]
    try {
      children = await api.getChildren(id)
    } catch (_) {
      partial = true
      return
    }

    for (const child of children) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      subagentCost += child.cost
      subagentCount += 1
      const entry: SubagentCost = { id: child.id, title: child.title || child.id, cost: child.cost }
      if (child.agent !== undefined) entry.agent = child.agent
      if (child.model !== undefined) entry.model = child.model
      if (child.tokens !== undefined) entry.tokens = child.tokens
      if (child.outcome !== undefined) entry.outcome = child.outcome
      if (child.time !== undefined) entry.time = child.time
      subagents.push(entry)
      await walk(child.id)
    }
  }

  await walk(rootId)

  return { totalCost: rootCost + subagentCost, subagentCost, subagentCount, partial, subagents }
}
