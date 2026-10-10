// The Workflows shell (#56): each Workflow's scan queue and Running list, and the Workflows built on it.
// No React here: App keeps one of each Workflow for the session and re-renders on changed(); Snipe-IT is reached only
// through the bridge passed in, so the tests drive it with a fake.
import type { Asset, SnipeItBridge, StatusLabel } from '../../main/snipeit'
import { workflowNote } from '../../main/notes'
import type { Outcome } from './BatchView'

// Why an action is off when Snipe-IT says the Operator's key may not do it.
export const NOT_ALLOWED = "Your Snipe-IT account isn't allowed to do this"

/** A Running list row's result: Batch's outcome states, plus waiting its turn in the queue. Refused and failed are both 'failed'. */
export type Result = { state: 'waiting' } | Outcome
/** One scan in a Running list. ctx is what the Workflow was set to when it was scanned (Bulk return: the Location). */
export type Row<C = unknown> = { key: number; time: string; tag: string; assetId: number | null; name: string; what: string; ctx: C; result: Result }
export type Events = { changed: () => void; failed?: () => void }
/** What a Workflow's step does to one scanned Asset: the done text and "what" cell, or a throw with the refusal. */
export type Act<C> = (asset: Asset, ctx: C) => Promise<{ text: string; what?: string }>

const hhmm = (d: Date) => d.toTimeString().slice(0, 5)
// What a scanner or a stray key adds around an Asset Tag: control characters anywhere, whitespace at the ends.
export const cleanTag = (raw: string) => raw.replace(/\p{Cc}/gu, '').trim()
const busy = (r: Row) => r.result.state === 'waiting' || r.result.state === 'working'

// One Workflow's queue and Running list. Scans queue and run one at a time in order (Batch's eachInTurn, for a list
// that keeps growing); a failure doesn't stop the next. In memory only: never saved or exported, like Recent scans.
// ponytail: one request in flight per Workflow; 2–3 requests per Asset stays well inside Snipe-IT's 120 a minute.
export function createRunner<C>(bridge: Pick<SnipeItBridge, 'assetByTag'>, act: Act<C>, events: Events, now = () => new Date()) {
  let rows: Row<C>[] = []
  let queue: Row<C>[] = []
  let next = 0
  // Bumped by reset(); a result that lands afterwards belongs to the old server and is dropped.
  let generation = 0
  let running = false
  let announce = ''

  const update = (key: number, change: Partial<Row<C>>) => {
    rows = rows.map((r) => (r.key === key ? { ...r, ...change } : r))
    events.changed()
  }
  const settle = (row: Row<C>, result: Outcome, change: Partial<Row<C>> = {}) => {
    announce = `${row.tag}: ${result.state === 'done' ? result.text : result.state === 'failed' ? result.reason : ''}`
    update(row.key, { ...change, result })
    if (result.state === 'failed') events.failed?.()
  }

  async function drain() {
    if (running) return
    running = true
    const mine = generation
    for (let row = queue.shift(); row; row = queue.shift()) {
      update(row.key, { result: { state: 'working' } })
      let found: Partial<Row<C>> = {}
      try {
        const asset = await bridge.assetByTag(row.tag)
        if (mine !== generation) return
        if (!asset) {
          settle(row, { state: 'failed', reason: `No Asset with tag ${row.tag}` })
          continue
        }
        found = { assetId: asset.id, name: asset.name || asset.model }
        update(row.key, found)
        const { text, what = '' } = await act(asset, row.ctx)
        if (mine !== generation) return
        settle(row, { state: 'done', text }, { what })
      } catch (e) {
        if (mine !== generation) return
        settle(row, { state: 'failed', reason: (e as Error).message })
      }
    }
    running = false
  }

  return {
    get rows() { return rows },
    /** How many scans are waiting or working. */
    get pending() { return rows.filter(busy).length },
    /** The newest result, for the polite live region. */
    get announce() { return announce },
    /** Queues a scan; returns what the status line should say ('' for nothing). */
    scan(raw: string, ctx: C): string {
      const tag = cleanTag(raw)
      if (!tag) return ''
      const twin = rows.find((r) => busy(r) && r.tag.toUpperCase() === tag.toUpperCase())
      if (twin) return `${twin.tag} is already scanned`
      const row: Row<C> = { key: ++next, time: hhmm(now()), tag, assetId: null, name: '', what: '', ctx, result: { state: 'waiting' } }
      rows = [row, ...rows]
      queue.push(row)
      events.changed()
      drain()
      return ''
    },
    clear() {
      if (rows.some(busy)) return
      rows = []
      announce = ''
      events.changed()
    },
    reset() {
      generation++
      running = false
      rows = []
      queue = []
      announce = ''
      events.changed()
    },
  }
}
export type Runner<C = unknown> = ReturnType<typeof createRunner<C>>

export type BulkReturnStep = { step: 'location' } | { step: 'scan'; location: StatusLabel }
export const READY = 'Ready to Deploy'
// Status Labels of the deployable type: Snipe-IT reports a checked-out one as 'deployed'.
const deployable = (a: Asset) => a.statusMeta === 'deployable' || a.statusMeta === 'deployed'

// Bulk return (#58): pick the one Location returns go to, then each scanned Asset that's checked out is checked in at
// once, set to Ready to Deploy and sent there. No confirm; Undo last (a later ticket) fixes mistakes.
export function createBulkReturn(bridge: Pick<SnipeItBridge, 'assetByTag' | 'checkin' | 'statusLabels'>, events: Events, now = () => new Date()) {
  let step: BulkReturnStep = { step: 'location' }
  // The Location picked last, highlighted when the next round starts.
  let last: StatusLabel | null = null
  // "Ready to Deploy", found by exact name once per session.
  let ready: number | undefined
  let session = 0

  const runner = createRunner<StatusLabel>(bridge, async (a, location) => {
    if (!a.can.checkin) throw new Error(NOT_ALLOWED)
    if (!a.assignee) {
      const earlier = runner.rows.find((r) => r.assetId === a.id && r.result.state === 'done')
      throw new Error(earlier ? `Already checked in at ${earlier.time}` : `${a.assetTag} isn't checked out (status: ${a.status || 'none'}). Nothing changed.`)
    }
    // A label someone set on purpose while it was out (Pending, Broken…) is kept, never silently cleared.
    const keep = !deployable(a)
    const what = `From ${a.assignee.type === 'asset' ? 'Asset ' : ''}${a.assignee.name}`
    await bridge.checkin(a.id, { statusId: keep ? undefined : ready, locationId: location.id, note: workflowNote('Bulk return') })
    return { text: keep ? `Kept status '${a.status}'` : 'Checked in', what }
  }, events, now)

  return {
    runner,
    get step() { return step },
    get last() { return last },
    /** Starts step 2 at this Location; returns why it can't ('' when it did). */
    async start(location: StatusLabel): Promise<string> {
      if (ready === undefined) {
        const mine = session
        const id = (await bridge.statusLabels()).find((l) => l.name === READY)?.id
        if (mine !== session) return ''
        if (id === undefined) return `No Status Label named '${READY}' in Snipe-IT`
        ready = id
      }
      step = { step: 'scan', location }
      last = location
      events.changed()
      return ''
    },
    /** Change Location, and Done (which also leaves for the Workflows page): back to step 1; the Running list stays. */
    done() {
      step = { step: 'location' }
      events.changed()
    },
    scan: (raw: string) => (step.step === 'scan' ? runner.scan(raw, step.location) : 'Pick the Location first'),
    reset() {
      session++
      step = { step: 'location' }
      last = null
      ready = undefined
      runner.reset()
    },
  }
}
export type BulkReturn = ReturnType<typeof createBulkReturn>
