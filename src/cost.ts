export type SessionLike = {
  id: string
  cost: number
  parentID?: string
  title?: string
}

export type CostApi = {
  getSession: (id: string) => SessionLike | undefined
  getChildren: (id: string) => Promise<SessionLike[]>
}

export type SubagentCost = {
  id: string
  title: string
  cost: number
}

export type SubtreeCostResult = {
  totalCost: number
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
  let totalCost = api.getSession(rootId)?.cost ?? 0
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
      totalCost += child.cost
      subagentCount += 1
      subagents.push({ id: child.id, title: child.title || child.id, cost: child.cost })
      await walk(child.id)
    }
  }

  await walk(rootId)

  return { totalCost, subagentCount, partial, subagents }
}
