// The Workflows shell (#56): each Workflow's scan queue and Running list, and the Workflows built on it.
// No React here: App keeps one of each Workflow for the session and re-renders on changed(); Snipe-IT is reached only
// through the bridge passed in, so the tests drive it with a fake.
import type { Asset, Assignee, SnipeItBridge, StatusLabel, UserCard } from '../../main/snipeit'
import { undoNote, workflowNote } from '../../main/notes'
import type { Outcome } from './BatchView'

// Why an action is off when Snipe-IT says the Operator's key may not do it.
export const NOT_ALLOWED = "Your Snipe-IT account isn't allowed to do this"

/** A Running list row's result: Batch's outcome states, plus waiting its turn in the queue, open in a confirm, put back
 *  by Undo last, and neutral (nothing written, nothing wrong: "Already theirs", "Skipped: not confirmed").
 *  Refused and failed are both 'failed'. */
export type Result = { state: 'waiting' } | { state: 'confirm' } | { state: 'undone' } | { state: 'neutral'; text: string } | Outcome
/** How Undo last puts a done row back. says: what was done, for the confirm. run: the opposite Snipe-IT action, given the
 *  Asset as it is now; it throws, saying what it found, when the Asset is no longer as the Workflow left it. */
export type Undo = { says: string; run: (now: Asset) => Promise<void> }
/** One scan in a Running list. ctx is what the Workflow was set to when it was scanned (Bulk return: the Location).
 *  before: the Asset as the lookup found it, before the Workflow acted. undo: how to put it back, or why it can't be.
 *  undoFailed: why the last Undo of it didn't happen. */
export type Row<C = unknown> = {
  key: number; time: string; tag: string; assetId: number | null; name: string; what: string; ctx: C; result: Result
  before: Asset | null; undo?: Undo | string; undoFailed?: string
  /** A line the Workflow adds between scans (Bulk checkout's "Checked out N Assets to <User>"); its text is the "what" cell. */
  line?: true
}
export type Events = { changed: () => void; failed?: () => void }
/** A done row: its result text, "what" cell and how to undo it. */
export type Done = { text: string; what?: string; undo?: Undo | string }
/** A confirm step (#56 §3). needs: the text it can't go without (e.g. "what happened"), if any. write: the Workflow's
 *  Snipe-IT action once confirmed, given the Asset re-read just now and the text typed; it throws to refuse. */
export type Confirm = { needs?: string; write: (now: Asset, text: string) => Promise<Done> }
/** What a Workflow's step does to one scanned Asset: done at once, a neutral row, or a confirm first; or a throw with the refusal. */
export type Act<C> = (asset: Asset, ctx: C) => Promise<Done | { neutral: string; what?: string } | { confirm: Confirm; what?: string }>
export const SKIPPED = 'Skipped: not confirmed'

const hhmm = (d: Date) => d.toTimeString().slice(0, 5)
// What a scanner or a stray key adds around an Asset Tag: control characters anywhere, whitespace at the ends.
export const cleanTag = (raw: string) => raw.replace(/\p{Cc}/gu, '').trim()
const busy = (r: Row) => r.result.state === 'waiting' || r.result.state === 'working'

// The least time between one queued Asset starting and the next: a Bulk return is 3 requests, so 1.5s keeps a fast
// scanner under Snipe-IT's default 120 requests a minute instead of turning the rest of the queue into throttled rows.
// ponytail: fixed pace per Workflow; pausing and retrying on a 429 (or when two Workflows run at once) is #96.
export const PACE_MS = 1500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One Workflow's queue and Running list. Scans queue and run one at a time in order (Batch's eachInTurn, for a list
// that keeps growing); a failure doesn't stop the next. In memory only: never saved or exported, like Recent scans.
// ponytail: one request in flight per Workflow; 2–3 requests per Asset stays well inside Snipe-IT's 120 a minute.
export function createRunner<C>(bridge: Pick<SnipeItBridge, 'assetByTag'>, act: Act<C>, events: Events, now = () => new Date(), pace = PACE_MS) {
  let rows: Row<C>[] = []
  let queue: Row<C>[] = []
  let next = 0
  // Bumped by reset(); a result that lands afterwards belongs to the old server and is dropped.
  let generation = 0
  let running = false
  let announce = ''
  let lastStart = 0
  // Undo last: the row whose confirm is open, and the undo in flight (queued scans wait for it).
  let confirming: Row<C> | null = null
  let undoing: Promise<void> | null = null
  // The confirm step that's open (at most one), the text typed into it, and each confirmed row's write, run in its turn.
  let opened: { key: number; confirm: Confirm; text: string } | null = null
  const writes = new Map<number, { write: Confirm['write']; text: string }>()
  // Off the Workflow's page: a confirm that would open is skipped, so nothing waits for an Operator who isn't looking.
  let away = false

  const update = (key: number, change: Partial<Row<C>>) => {
    rows = rows.map((r) => (r.key === key ? { ...r, ...change } : r))
    events.changed()
  }
  const settle = (row: Row<C>, result: Outcome | { state: 'neutral'; text: string }, change: Partial<Row<C>> = {}) => {
    announce = `${row.tag}: ${result.state === 'failed' ? result.reason : result.state === 'working' ? '' : result.text}`
    update(row.key, { ...change, result })
    if (result.state === 'failed') events.failed?.()
  }

  async function drain() {
    if (running) return
    running = true
    const mine = generation
    for (let row = queue.shift(); row; row = queue.shift()) {
      if (undoing) await undoing
      const wait = lastStart + pace - Date.now()
      if (wait > 0) await sleep(wait)
      if (mine !== generation) return
      lastStart = Date.now()
      update(row.key, { result: { state: 'working' } })
      const confirmed = writes.get(row.key)
      writes.delete(row.key)
      try {
        const asset = await bridge.assetByTag(row.tag)
        if (mine !== generation) return
        if (confirmed) {
          // The confirm gave the Asset time to change; the write only ever touches the Asset that was confirmed.
          const { assetId } = rows.find((r) => r.key === row.key)!
          if (asset?.id !== assetId) throw new Error(asset ? `${row.tag} is another Asset's tag now` : `No Asset with tag ${row.tag} now`)
          const { text, what = row.what, undo } = await confirmed.write(asset, confirmed.text)
          if (mine !== generation) return
          settle(row, { state: 'done', text }, { what, undo })
          continue
        }
        if (!asset) {
          settle(row, { state: 'failed', reason: `No Asset with tag ${row.tag}` })
          continue
        }
        update(row.key, { assetId: asset.id, name: asset.name || asset.model, before: asset })
        const step = await act(asset, row.ctx)
        if (mine !== generation) return
        if ('confirm' in step) {
          // At most one open: a newer one skips the one still waiting, as a different scan would.
          skipOpen()
          if (away) settle(row, { state: 'neutral', text: SKIPPED }, { what: step.what ?? '' })
          else {
            opened = { key: row.key, confirm: step.confirm, text: '' }
            update(row.key, { what: step.what ?? '', result: { state: 'confirm' } })
          }
        } else if ('neutral' in step) settle(row, { state: 'neutral', text: step.neutral }, { what: step.what ?? '' })
        else settle(row, { state: 'done', text: step.text }, { what: step.what ?? '', undo: step.undo })
      } catch (e) {
        if (mine !== generation) return
        settle(row, { state: 'failed', reason: (e as Error).message })
      }
    }
    running = false
  }

  const openRow = () => (opened ? rows.find((r) => r.key === opened!.key) : undefined)
  // Closes the open confirm without writing anything.
  function skipOpen() {
    if (!opened) return
    const row = openRow()!
    opened = null
    settle(row, { state: 'neutral', text: SKIPPED })
  }
  // Confirms the open confirm: its write joins the queue. Returns what's missing ('' when it went).
  function confirmOpen(): string {
    if (!opened) return ''
    const { confirm, text } = opened
    const row = openRow()!
    if (confirm.needs && !text.trim()) return `Type ${confirm.needs} first`
    opened = null
    writes.set(row.key, { write: confirm.write, text: text.trim() })
    queue.push(row)
    update(row.key, { result: { state: 'waiting' } })
    drain()
    return ''
  }

  // Undo last acts on the newest done row, once: after it's undone (or another row is done), nothing older can be.
  const undoTarget = () => {
    const r = rows.find((r) => r.result.state === 'done' || r.result.state === 'undone')
    return r?.result.state === 'done' && r.undo ? r : null
  }
  const waits = () => rows.some(busy) || !!undoing || !!opened
  // Why Undo last is off ('' when it isn't): it waits for the queue and any open confirm, so "last" is well defined.
  const undoBlocked = () => {
    if (opened) return 'Undo waits for the open confirm'
    if (waits()) return 'Undo waits until nothing is waiting or working'
    if (confirming) return 'Undo is waiting for Enter or Esc'
    const undo = undoTarget()?.undo
    return typeof undo === 'string' ? undo : undo ? '' : 'Nothing to undo'
  }

  return {
    get rows() { return rows },
    /** How many scans are waiting or working. */
    get pending() { return rows.filter(busy).length },
    /** The newest result, for the polite live region. */
    get announce() { return announce },
    /** Why Undo last is off, or '' when it can be asked for. */
    get undoBlocked() { return undoBlocked() },
    /** Why Clear is off, or '' when it isn't. */
    get clearBlocked() { return waits() ? 'Waits until nothing is waiting or working' : '' },
    /** The open Undo last confirm's text, or null. */
    get confirm() { return confirming && `Undo: ${(confirming.undo as Undo).says}? Enter to undo, Esc to cancel.` },
    /** The open confirm step: its row, the text it needs (if any) and the text typed so far; or null. */
    get open() { return opened && { row: openRow()!, needs: opened.confirm.needs, text: opened.text } },
    /** The open confirm's text, as typed. */
    setText(text: string) {
      if (opened) opened.text = text
    },
    /** Enter on the empty field: confirms the open confirm. Returns what's missing ('' when it went). */
    confirmOpen,
    /** Esc, Done or leaving: the open confirm's Asset is skipped, never written. */
    cancelOpen: skipOpen,
    /** Enter in a confirm's text field. One word is checked as an Asset Tag first, and is a scan of it if it is one;
     *  anything else is the text, and confirms. Returns what the status line should say. */
    async submitText(raw: string, ctx: C): Promise<string> {
      const key = opened?.key
      const word = cleanTag(raw)
      if (key && word && !/\s/.test(word)) {
        const asset = await bridge.assetByTag(word).catch(() => null)
        // Esc, another scan or leaving while it was looked up: this text no longer belongs to the confirm.
        if (opened?.key !== key) return ''
        if (asset) return this.scan(word, ctx)
      }
      if (!opened) return ''
      opened.text = raw
      return confirmOpen()
    },
    /** Leaving the Workflow's page: an open confirm or Undo confirm closes without writing; the queue keeps running. */
    leave() {
      away = true
      skipOpen()
      confirming = null
      events.changed()
    },
    /** Back on the Workflow's page. */
    enter() {
      away = false
    },
    /** Adds a line row (e.g. a summary when a round ends). */
    addLine(ctx: C) {
      rows = [{ key: ++next, time: hhmm(now()), tag: '', assetId: null, name: '', what: '', ctx, result: { state: 'neutral', text: '' }, before: null, line: true }, ...rows]
      events.changed()
    },
    /** Opens Undo last's confirm for the newest done row; returns why it can't ('' when it did). */
    askUndo(): string {
      const why = undoBlocked()
      if (why) return why
      confirming = undoTarget()
      events.changed()
      return ''
    },
    cancelUndo() {
      if (!confirming) return
      confirming = null
      events.changed()
    },
    /** Confirms the open Undo: re-reads the Asset, then the Workflow's opposite action. The row becomes Undone, or stays done and says why not. */
    async undo(): Promise<void> {
      const row = confirming
      confirming = null
      if (!row || undoBlocked() || undoTarget() !== row) return events.changed()
      const { run } = row.undo as Undo
      const mine = generation
      let release = () => {}
      undoing = new Promise((r) => { release = r })
      events.changed()
      try {
        const now = await bridge.assetByTag(row.tag)
        if (mine !== generation) return
        // The tag may have been edited or given to another Asset since; undo only ever touches the Asset it acted on.
        if (now?.id !== row.assetId) throw new Error(now ? `${row.tag} is another Asset's tag now` : `No Asset with tag ${row.tag} now`)
        await run(now)
        if (mine !== generation) return
        announce = `${row.tag}: Undone`
        update(row.key, { result: { state: 'undone' }, undoFailed: undefined })
      } catch (e) {
        if (mine !== generation) return
        announce = `${row.tag}: ${(e as Error).message}`
        update(row.key, { undoFailed: (e as Error).message })
        events.failed?.()
      } finally {
        if (mine === generation) {
          undoing = null
          events.changed()
        }
        release()
      }
    },
    /** Queues a scan; returns what the status line should say ('' for nothing). */
    scan(raw: string, ctx: C): string {
      const tag = cleanTag(raw)
      if (!tag) return ''
      // Rescanning the tag a confirm is open for confirms it (scanner-only work).
      if (openRow()?.tag.toUpperCase() === tag.toUpperCase()) return confirmOpen()
      const twin = rows.find((r) => busy(r) && r.tag.toUpperCase() === tag.toUpperCase())
      if (twin) return `${twin.tag} is already scanned`
      // A different tag skips the Asset waiting in a confirm; a scan closes an open Undo confirm: "last" is about to change.
      skipOpen()
      confirming = null
      const row: Row<C> = { key: ++next, time: hhmm(now()), tag, assetId: null, name: '', what: '', ctx, result: { state: 'waiting' }, before: null }
      rows = [row, ...rows]
      queue.push(row)
      events.changed()
      drain()
      return ''
    },
    clear() {
      if (waits()) return
      confirming = null
      rows = []
      announce = ''
      events.changed()
    },
    reset() {
      generation++
      // The old drain() returns at its next generation check without touching running, so a new one can start now.
      running = false
      confirming = null
      undoing = null
      opened = null
      writes.clear()
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

// Bulk return (#58): pick the one Location returns go to, then each scanned Asset that's checked out is checked in at
// once, set to Ready to Deploy and sent there. No confirm; Undo last fixes mistakes.
export function createBulkReturn(bridge: Pick<SnipeItBridge, 'assetByTag' | 'checkin' | 'checkout' | 'statusLabels'>, events: Events, now = () => new Date(), pace = PACE_MS) {
  let step: BulkReturnStep = { step: 'location' }
  // The Location picked last, highlighted when the next round starts.
  let last: StatusLabel | null = null
  // "Ready to Deploy", found by exact name once per session.
  let ready: number | undefined
  // Bumped by every start, Done and reset, so a start still finding the label never lands after a newer pick or after leaving.
  let attempt = 0

  const runner = createRunner<StatusLabel>(bridge, async (a, location) => {
    if (!a.can.checkin) throw new Error(NOT_ALLOWED)
    if (!a.assignee) {
      const earlier = runner.rows.find((r) => r.assetId === a.id && r.result.state === 'done')
      throw new Error(earlier ? `Already checked in at ${earlier.time}` : `${a.assetTag} isn't checked out (status: ${a.status || 'none'}). Nothing changed.`)
    }
    // A label someone set on purpose while it was out (Pending, Broken…) is kept, never silently cleared.
    const keep = a.statusType !== 'deployable'
    const { assignee: was, statusId, expectedCheckin } = a
    const from = `${was.type === 'asset' ? 'Asset ' : ''}${was.name}`
    await bridge.checkin(a.id, { statusId: keep ? undefined : ready, locationId: location.id, note: workflowNote('Bulk return') })
    // Undo: a Checkout back to the same Assignee with the old Status Label and Expected Checkin. Snipe-IT's Checkout sets
    // the Location; the old one isn't forced back. A time of day means it was a Temp checkout, so the undo makes it one again.
    const left = ready
    const run = async (now: Asset) => {
      if (now.assignee) throw new Error(`${now.assetTag} is checked out to ${now.assignee.name} now`)
      // A label someone set since the return isn't overwritten with the old one.
      if (now.statusId !== left) throw new Error(`${now.assetTag} is '${now.status}' now`)
      const due = expectedCheckin && expectedCheckin.length > 10 ? expectedCheckin : undefined
      await bridge.checkout(a.id, { targetType: was.type, targetId: was.id, statusId: statusId ?? undefined, expectedCheckin: expectedCheckin ?? undefined, note: undoNote('Bulk return', due) })
    }
    // Snipe-IT checks out only an Asset whose Status Label is deployable, so a kept label can't be undone from the list.
    const undo = keep ? `Snipe-IT can't check out an Asset with status '${a.status}'. Open ${a.assetTag} to put it back by hand.` : { says: `${a.assetTag} checked in from ${from}`, run }
    return { text: keep ? `Kept status '${a.status}'` : 'Checked in', what: `From ${from}`, undo }
  }, events, now, pace)

  return {
    runner,
    get step() { return step },
    get last() { return last },
    /** Starts step 2 at this Location; returns why it can't ('' when it did). */
    async start(location: StatusLabel): Promise<string> {
      const mine = ++attempt
      if (ready === undefined) {
        const id = (await bridge.statusLabels()).find((l) => l.name === READY)?.id
        if (mine !== attempt) return ''
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
      attempt++
      step = { step: 'location' }
      events.changed()
    },
    scan: (raw: string) => (step.step === 'scan' ? runner.scan(raw, step.location) : 'Pick the Location first'),
    reset() {
      attempt++
      step = { step: 'location' }
      last = null
      ready = undefined
      runner.reset()
    },
  }
}
export type BulkReturn = ReturnType<typeof createBulkReturn>

export type BulkCheckoutStep = { step: 'user' } | { step: 'scan'; user: UserCard; round: number }
/** Bulk checkout's Options: a date-only Expected Checkin and a note, each '' when not set. */
export type CheckoutSession = { expectedCheckin: string; note: string }
/** What a Bulk checkout scan was made under: the User, which round with them, and the Options. */
export type CheckoutCtx = CheckoutSession & { user: UserCard; round: number }
const NO_OPTIONS: CheckoutSession = { expectedCheckin: '', note: '' }
const assigneeName = (a: Assignee) => `${a.type === 'asset' ? 'Asset ' : ''}${a.name}`

// Bulk checkout (#57): find the User, then each scanned Asset is checked, confirmed and checked out to them until Done.
export function createBulkCheckout(bridge: Pick<SnipeItBridge, 'assetByTag' | 'checkin' | 'checkout' | 'exactUsers' | 'userSelectlist' | 'userCard'>, events: Events, now = () => new Date(), pace = PACE_MS) {
  let step: BulkCheckoutStep = { step: 'user' }
  let options = NO_OPTIONS
  let round = 0
  // Bumped by every find, Done and reset, so a slower find never lands after a newer one or after Done.
  let attempt = 0

  const runner = createRunner<CheckoutCtx>(bridge, async (a, { user, expectedCheckin, note }) => {
    const what = `To ${user.name}`
    if (a.assignee?.type === 'user' && a.assignee.id === user.id) return { neutral: 'Already theirs', what }
    // ponytail: someone else's Asset is refused for now; the choice step (Move to this User / Stop) is #91.
    if (a.assignee) throw new Error(`Checked out to ${assigneeName(a.assignee)}`)
    if (a.statusType !== 'deployable') throw new Error(`"${a.assetTag}" is "${a.status}", which can't be checked out`)
    if (!a.can.checkout) throw new Error(NOT_ALLOWED)
    const write = async (now: Asset): Promise<Done> => {
      if (now.assignee || now.statusId !== a.statusId || now.locationId !== a.locationId) throw new Error(`${a.assetTag} changed since it was scanned`)
      await bridge.checkout(a.id, { targetType: 'user', targetId: user.id, expectedCheckin: expectedCheckin || undefined, note: workflowNote('Bulk checkout', { text: note }) })
      // Undo: a Checkin putting back the Status Label and Location it had (Snipe-IT's Checkin would send it to its Default Location).
      const run = async (now: Asset) => {
        if (now.assignee?.type !== 'user' || now.assignee.id !== user.id) throw new Error(`${a.assetTag} is no longer checked out to ${user.name}`)
        // A label someone set since the Checkout isn't overwritten with the old one.
        if (now.statusId !== a.statusId) throw new Error(`${a.assetTag} is '${now.status}' now`)
        await bridge.checkin(a.id, { statusId: a.statusId ?? undefined, locationId: a.locationId ?? undefined, note: undoNote('Bulk checkout') })
      }
      return { text: 'Checked out', undo: { says: `${a.assetTag} → ${user.name}`, run } }
    }
    return { what, confirm: { write } }
  }, events, now, pace)

  function choose(user: UserCard) {
    step = { step: 'scan', user, round: ++round }
    events.changed()
  }

  return {
    runner,
    get step() { return step },
    get options() { return options },
    /** Sets the Options for every Checkout from now on; returns why not ('' when set). */
    setOptions(o: CheckoutSession): string {
      try {
        workflowNote('Bulk checkout', { text: o.note })
      } catch (e) {
        return (e as Error).message
      }
      options = o
      events.changed()
      return ''
    },
    /** Snipe-IT's User picker list for the typeahead. */
    suggest: (text: string) => bridge.userSelectlist(text),
    /** Enter in step 1: a single exact match (employee number or email, then username) goes straight to step 2; then the
     *  highlighted row of a list the Operator has seen; else the picker list, picked when it has one row, else listed. */
    async find(text: string, shown?: StatusLabel[] | null, hi = 0): Promise<{ users?: StatusLabel[]; status: string }> {
      const q = text.trim()
      if (!q) return { status: 'Type a name, email or employee number' }
      const mine = ++attempt
      const exact = await bridge.exactUsers(q)
      if (mine !== attempt) return { status: '' }
      if (exact.length === 1) return choose(exact[0]), { status: '' }
      if (shown?.length) return this.pick(shown[Math.min(hi, shown.length - 1)].id, mine)
      const users = await bridge.userSelectlist(q)
      if (mine !== attempt) return { status: '' }
      if (users.length === 1) return this.pick(users[0].id, mine)
      if (users.length) return { users, status: `${users.length} Users match '${q}'. Pick one.` }
      // A tag scanned here by mistake just finds no User; no request is spent finding out it was a tag.
      const tagLike = !/\s/.test(q) && /\d/.test(q) && /\p{L}/u.test(q)
      return { users: [], status: `No User matches '${q}'${tagLike ? '. Find the User first, then scan Assets.' : ''}` }
    },
    /** Picks a User from the list: their header is read, then step 2. */
    async pick(id: number, mine = ++attempt): Promise<{ status: string }> {
      const user = await bridge.userCard(id)
      if (mine === attempt) choose(user)
      return { status: '' }
    },
    scan: (raw: string) => (step.step === 'scan' ? runner.scan(raw, { ...options, user: step.user, round: step.round }) : 'Find the User first'),
    /** "Checked out N Assets to <User>" for a round's line: its done rows, counted as they land. */
    summary(line: Row<CheckoutCtx>) {
      const n = runner.rows.filter((r) => !r.line && r.ctx.round === line.ctx.round && r.result.state === 'done').length
      return `Checked out ${n} Asset${n === 1 ? '' : 's'} to ${line.ctx.user.name}`
    },
    /** Done (or Esc): skips an open confirm, ends this User with a line in the Running list, and goes back to step 1. */
    done() {
      attempt++
      runner.cancelOpen()
      runner.cancelUndo()
      if (step.step === 'scan') {
        const { user, round: r } = step
        if (runner.rows.some((row) => !row.line && row.ctx.round === r)) runner.addLine({ ...options, user, round: r })
      }
      step = { step: 'user' }
      events.changed()
    },
    reset() {
      attempt++
      step = { step: 'user' }
      options = NO_OPTIONS
      runner.reset()
    },
  }
}
export type BulkCheckout = ReturnType<typeof createBulkCheckout>
