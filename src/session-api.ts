import type { CostApi, SessionLike } from "./cost.js"
import { subtreeCost } from "./cost.js"

type SessionSource = {
  getSession: (id: string) => SessionLike | undefined
  listSessions: (input: { parentID?: string; cursor?: string; limit: number }) => Promise<{
    data: SessionLike[]
    cursor: { next?: string | null }
  }>
}

export async function refreshCost(api: CostApi, rootID: string, sync: () => Promise<void>) {
  let stale = false
  try {
    await sync()
  } catch {
    stale = true
  }
  const result = await subtreeCost(api, rootID)
  return { ...result, partial: result.partial || stale }
}

export function makeCostApi(source: SessionSource): CostApi {
  return {
    getSession: source.getSession,
    getChildren: async (id) => {
      const children: SessionLike[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await source.listSessions(cursor ? { cursor, limit: 100 } : { parentID: id, limit: 100 })
        children.push(...page.data)
        cursor = page.data.length ? page.cursor.next ?? undefined : undefined
        if (cursor && seenCursors.has(cursor)) throw new Error("Repeated session pagination cursor")
        if (cursor) seenCursors.add(cursor)
      } while (cursor)
      return children
    },
  }
}
