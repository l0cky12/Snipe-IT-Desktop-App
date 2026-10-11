// The Workflows shell (#56): each Workflow's scan queue and Running list, and the Workflows built on it.
// No React here: App keeps one of each Workflow for the session and re-renders on changed(); Snipe-IT is reached only
// through the bridge passed in, so the tests drive it with a fake.
import type { Asset, Assignee, OpenMaintenance, SnipeItBridge, StatusLabel, UserCard } from '../../main/snipeit'
import { localDate } from '../../main/export'
import { cleanText, repairCost, undoNote, userNotesLine, workflowNote } from '../../main/notes'
import type { Outcome } from './BatchView'

// Why an action is off when Snipe-IT says the Operator's key may not do it.
export const NOT_ALLOWED = "Your Snipe-IT account isn't allowed to do this"

/** A Running list row's result: Batch's outcome states, plus waiting its turn in the queue, open in a confirm or a
 *  choice, put back by Undo last, and neutral (nothing written, nothing wrong: "Already theirs", "Skipped: not confirmed").
 *  Refused, failed and stopped are all 'failed'. */
export type Result = { state: 'waiting' } | { state: 'confirm' } | { state: 'choice' } | { state: 'undone' } | { state: 'neutral'; text: string } | Outcome
/** How Undo last puts a done row back. says: what was done, for the confirm. run: the opposite Snipe-IT action, given the
 *  Asset as it is now; it throws, saying what it found, when the Asset is no longer as the Workflow left it. Once the
 *  Asset is put back, it resolves to what it couldn't put back besides, if anything. */
export type Undo = { says: string; run: (now: Asset) => Promise<string | void> }
/** One scan in a Running list. ctx is what the Workflow was set to when it was scanned (Bulk return: the Location).
 *  before: the Asset as the lookup found it, before the Workflow acted. undo: how to put it back, or why it can't be.
 *  undoFailed: why the last Undo of it didn't happen; once Undone, what that Undo couldn't put back. */
export type Row<C = unknown> = {
  key: number; time: string; tag: string; assetId: number | null; name: string; what: string; ctx: C; result: Result
  before: Asset | null; undo?: Undo | string; undoFailed?: string
  /** A done row's sub-results ("Maintenance opened"), and a line the Operator can copy to add by hand. */
  sub?: string[]; copy?: string
  /** A line the Workflow adds between scans (Bulk checkout's "Checked out N Assets to <User>"); its text is the "what" cell. */
  line?: true
}
export type Events = { changed: () => void; failed?: () => void }
/** A done row: its result text, "what" cell, how to undo it, and any sub-results and line to copy. */
export type Done = { text: string; what?: string; undo?: Undo | string; sub?: string[]; copy?: string }
/** A confirm step (#56 §3). needs: when it has text it can't go without, what the status line says while that's empty
 *  ("Say what happened"). says: what will be written, for the card. check: what's wrong with the text typed or the
 *  Workflow's other fields ('' when nothing), which keeps it open. write: the Workflow's Snipe-IT action once confirmed,
 *  given the Asset re-read just now and the text typed; it throws to refuse. */
export type Confirm = { needs?: string; says?: string; check?: (text: string) => string; write: (now: Asset, text: string) => Promise<Done> }
/** A choice step (#56 §3): an Asset that can't go through as scanned. fix: the fix-it button's label; blocked: why it's
 *  off ('' when it isn't); stop: what's in the way, for "Stopped: <stop>"; check: as a confirm's; write: the fix-it
 *  action, given the Asset re-read just now and any text typed; it throws to refuse. Only an explicit pick runs it: Enter
 *  and a same-tag rescan never do. */
export type Choice = { fix: string; blocked: string; stop: string; check?: (text: string) => string; write: (now: Asset, text: string) => Promise<Done> }
/** What a Workflow's step does to one scanned Asset: done at once, a neutral row, or a confirm or choice first; or a throw with the refusal. */
export type Act<C> = (asset: Asset, ctx: C) => Promise<Done | { neutral: string; what?: string } | { confirm: Confirm; what?: string } | { choice: Choice; what?: string }>
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
  // The confirm or choice step that's open (at most one of either), the text typed into a confirm, and each confirmed
  // (or fixed) row's write, run in its turn.
  let opened: { key: number; confirm?: Confirm; choice?: Choice; text: string } | null = null
  const writes = new Map<number, { write: Confirm['write']; text: string }>()
  // Off the Workflow's page: a confirm that would open is skipped, so nothing waits for an Operator who isn't looking.
  let away = false
  // Bumped by each field submission checked as a tag, so an older lookup never confirms or clears newer input.
  let typing = 0

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
          const { text, what = row.what, undo, sub, copy } = await confirmed.write(asset, confirmed.text)
          if (mine !== generation) return
          settle(row, { state: 'done', text }, { what, undo, sub, copy })
          continue
        }
        if (!asset) {
          settle(row, { state: 'failed', reason: `No Asset with tag ${row.tag}` })
          continue
        }
        update(row.key, { assetId: asset.id, name: asset.name || asset.model, before: asset })
        const step = await act(asset, row.ctx)
        if (mine !== generation) return
        if ('confirm' in step || 'choice' in step) {
          // At most one open: a newer one skips or stops the one still waiting, as a different scan would.
          skipOpen()
          const shut = 'choice' in step ? stopped(step.choice) : ({ state: 'neutral', text: SKIPPED } as const)
          if (away) settle(row, shut, { what: step.what ?? '' })
          else {
            opened = 'choice' in step ? { key: row.key, choice: step.choice, text: '' } : { key: row.key, confirm: step.confirm, text: '' }
            update(row.key, { what: step.what ?? '', result: { state: 'choice' in step ? 'choice' : 'confirm' } })
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
  // A stopped choice is a red row with the error sound, so the Operator can find it and fix it by hand.
  const stopped = (c: Choice) => ({ state: 'failed', reason: `Stopped: ${c.stop}` }) as const
  // Closes the open confirm (skipped) or choice (stopped) without writing anything.
  function skipOpen() {
    if (!opened) return
    const row = openRow()!
    const { choice } = opened
    opened = null
    settle(row, choice ? stopped(choice) : { state: 'neutral', text: SKIPPED })
  }
  // The open step's write joins the queue.
  function queueWrite(write: Confirm['write'], text: string) {
    const row = openRow()!
    opened = null
    writes.set(row.key, { write, text })
    queue.push(row)
    update(row.key, { result: { state: 'waiting' } })
    drain()
  }
  // Enter on the empty field, or a same-tag rescan: confirms the open confirm, and never picks a choice's fix-it action.
  // Returns what's missing ('' when it went).
  function confirmOpen(): string {
    if (!opened) return ''
    const { confirm, choice, text } = opened
    if (choice) return `${openRow()!.tag}: pick ${choice.fix} or Stop`
    if (confirm!.needs && !text.trim()) return confirm!.needs
    const wrong = confirm!.check?.(text)
    if (wrong) return wrong
    queueWrite(confirm!.write, text.trim())
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
    if (opened) return `Undo waits for the open ${opened.choice ? 'choice' : 'confirm'}`
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
    /** The open confirm or choice step: its row, what a confirm says while its required text is empty (if any), what it
     *  will write and the text typed so far, or the choice; or null. */
    get open() { return opened && { row: openRow()!, needs: opened.confirm?.needs, says: opened.confirm?.says, text: opened.text, choice: opened.choice } },
    /** The open confirm's text, as typed. */
    setText(text: string) {
      if (opened) opened.text = text
    },
    /** Enter on the empty field: confirms the open confirm. Returns what's missing ('' when it went). */
    confirmOpen,
    /** The open choice's fix-it button, clicked (or Tab, then Enter): its write joins the queue. Returns why not ('' when it went). */
    fixOpen(): string {
      if (!opened?.choice) return ''
      const { blocked, check, write } = opened.choice
      const wrong = blocked || check?.(opened.text)
      if (wrong) return wrong
      queueWrite(write, opened.text.trim())
      return ''
    },
    /** Esc, Done or leaving: the open confirm's Asset is skipped, or the open choice's stopped; never written. */
    cancelOpen: skipOpen,
    /** One word typed into a field of the open confirm may be a scan that landed there: it's checked as an Asset Tag,
     *  and if it is one, clear() empties that field and it's scanned. Resolves to what the status line should say, or
     *  null when it isn't a tag (or isn't one word), so the field keeps it. */
    async typedTag(raw: string, ctx: C, clear: () => void): Promise<string | null> {
      const key = opened?.key
      const mine = ++typing
      const word = cleanTag(raw)
      if (!key || !word || /\s/.test(word)) return null
      const asset = await bridge.assetByTag(word).catch((e: Error) => e)
      // Esc, another scan, newer input or leaving while it was looked up: this text no longer belongs to the confirm.
      if (opened?.key !== key || mine !== typing) return ''
      // It may have been a scan, so it never becomes the text unchecked; the confirm stays open.
      if (asset instanceof Error) return `Couldn't check whether ${word} is an Asset Tag: ${asset.message}`
      if (!asset) return null
      clear()
      return this.scan(word, ctx)
    },
    /** Enter in a confirm's text field. One word is checked as an Asset Tag first, and is a scan of it if it is one;
     *  anything else is the text, and confirms. Returns what the status line should say. */
    async submitText(raw: string, ctx: C): Promise<string> {
      // The text was the tag, so nothing has been said yet.
      const scanned = await this.typedTag(raw, ctx, () => opened && (opened.text = ''))
      if (scanned !== null) return scanned
      if (!opened) return ''
      opened.text = raw
      return confirmOpen()
    },
    /** Leaving the Workflow's page: an open confirm, choice or Undo confirm closes without writing; the queue keeps running. */
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
        const left = (await run(now)) || undefined
        if (mine !== generation) return
        announce = `${row.tag}: Undone${left ? `, but ${left}` : ''}`
        update(row.key, { result: { state: 'undone' }, undoFailed: left })
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
      // Rescanning the tag a confirm is open for confirms it (scanner-only work); a choice's, never.
      if (openRow()?.tag.toUpperCase() === tag.toUpperCase()) return confirmOpen()
      const twin = rows.find((r) => busy(r) && r.tag.toUpperCase() === tag.toUpperCase())
      if (twin) return `${twin.tag} is already scanned`
      // A different tag skips the Asset waiting in a confirm, or stops the one in a choice; a scan closes an open Undo
      // confirm: "last" is about to change.
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
export const assigneeName = (a: Assignee) => `${a.type === 'asset' ? 'Asset ' : ''}${a.name}`

// Bulk checkout (#57): find the User, then each scanned Asset is checked, confirmed and checked out to them until Done.
// Someone else's Asset opens a choice instead: Move to this User, or Stop.
export function createBulkCheckout(bridge: Pick<SnipeItBridge, 'assetByTag' | 'checkin' | 'checkout' | 'exactUsers' | 'userSelectlist' | 'userCard'>, events: Events, now = () => new Date(), pace = PACE_MS) {
  let step: BulkCheckoutStep = { step: 'user' }
  let options = NO_OPTIONS
  let round = 0
  // Bumped by every find, Done and reset, so a slower find never lands after a newer one or after Done.
  let attempt = 0
  // Bumped by reset (Settings pointing at another server): a two-call write stops before its second call, which would
  // otherwise go to the new server with the old server's ids.
  let session = 0
  const sameSession = (mine: number) => {
    if (mine !== session) throw new Error('Stopped: Settings changed')
  }

  const runner = createRunner<CheckoutCtx>(bridge, async (a, { user, round, expectedCheckin, note }) => {
    const what = `To ${user.name}`
    if (a.assignee?.type === 'user' && a.assignee.id === user.id) return { neutral: 'Already theirs', what }
    // Checked before a choice too: a Move checks out again, so it needs a deployable label and a key that may check out.
    if (a.statusType !== 'deployable') throw new Error(`"${a.assetTag}" is "${a.status}", which can't be checked out`)
    if (!a.can.checkout) throw new Error(NOT_ALLOWED)
    const was = a.assignee
    const stop = was && `checked out to ${assigneeName(was)}`
    // Scanned for a User who's since been Done: no confirm or choice opens for a round that's over.
    if (step.step !== 'scan' || step.round !== round) {
      if (stop) throw new Error(`Stopped: ${stop}`)
      return { neutral: SKIPPED, what }
    }
    // Undo's guard: it's still checked out to this User.
    const stillTheirs = (now: Asset) => {
      if (now.assignee?.type !== 'user' || now.assignee.id !== user.id) throw new Error(`${a.assetTag} is no longer checked out to ${user.name}`)
    }
    const checkout = () => bridge.checkout(a.id, { targetType: 'user', targetId: user.id, expectedCheckin: expectedCheckin || undefined, note: workflowNote('Bulk checkout', { text: note }) })
    if (was) {
      // Someone else's: the choice step. Move checks it in from them (no Status Label change), then out to this User.
      const from = assigneeName(was)
      const move = async (now: Asset): Promise<Done> => {
        // Checked before the Checkin, so a Checkout that can't happen leaves nothing half done.
        if (now.assignee?.type !== was.type || now.assignee.id !== was.id || now.statusId !== a.statusId || now.statusType !== 'deployable') throw new Error(`${a.assetTag} changed since it was scanned`)
        if (!now.can.checkin || !now.can.checkout) throw new Error(NOT_ALLOWED)
        const mine = session
        await bridge.checkin(a.id, { note: workflowNote('Bulk checkout', { move: true }) })
        sameSession(mine)
        // Left checked in, with no automatic return to the previous Assignee, so the Operator sees it and sorts it out.
        await checkout().catch((e: Error) => { throw new Error(`Checked in from ${from}, but checkout to ${user.name} failed: ${e.message}`) })
        // Undo: a Checkin, then a Checkout back to the previous Assignee with the Status Label and Expected Checkin it
        // had. A time of day means it was a Temp checkout, so the undo makes it one again.
        const run = async (now: Asset) => {
          stillTheirs(now)
          // A label changed (or made non-deployable) since couldn't be checked out again.
          if (now.statusId !== a.statusId || now.statusType !== 'deployable') throw new Error(`${a.assetTag} is '${now.status}' now`)
          // Both calls must be allowed before the first, so a refused Checkout never leaves it checked in.
          if (!now.can.checkin || !now.can.checkout) throw new Error(NOT_ALLOWED)
          const { expectedCheckin: due } = a
          const mine = session
          await bridge.checkin(a.id, { note: undoNote('Bulk checkout') })
          sameSession(mine)
          await bridge.checkout(a.id, { targetType: was.type, targetId: was.id, statusId: a.statusId ?? undefined, expectedCheckin: due ?? undefined, note: undoNote('Bulk checkout', due && due.length > 10 ? due : undefined) })
            .catch((e: Error) => { throw new Error(`Checked in from ${user.name}, but checkout back to ${from} failed: ${e.message}`) })
        }
        return { text: 'Checked out', what: `Moved from ${from}`, undo: { says: `${a.assetTag} → ${user.name}, moved from ${from}`, run } }
      }
      return { what, choice: { fix: 'Move to this User', blocked: a.can.checkin ? '' : NOT_ALLOWED, stop: stop!, write: move } }
    }
    const write = async (now: Asset): Promise<Done> => {
      if (now.assignee || now.statusId !== a.statusId || now.locationId !== a.locationId) throw new Error(`${a.assetTag} changed since it was scanned`)
      await checkout()
      // Undo: a Checkin putting back the Status Label and Location it had (Snipe-IT's Checkin would send it to its Default Location).
      const run = async (now: Asset) => {
        stillTheirs(now)
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
    /** The text changed: a find still waiting never lands. */
    stopFinding() {
      attempt++
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
      if (step.step === 'scan') runner.addLine({ ...options, user: step.user, round: step.round })
      step = { step: 'user' }
      events.changed()
    },
    reset() {
      attempt++
      session++
      step = { step: 'user' }
      options = NO_OPTIONS
      runner.reset()
    },
  }
}
export type BulkCheckout = ReturnType<typeof createBulkCheckout>

export const DAMAGED = 'Damaged'
const noLabel = (name: string) => `No Status Label named '${name}' in Snipe-IT; ask a Snipe-IT superuser to create one`
export const NO_DAMAGED = noLabel(DAMAGED)
const isRepair = (t: StatusLabel | null, typeId: number | null) => !!t && (t.id === typeId || t.name.trim().toLowerCase() === 'repair')
/** What a repair Workflow needs from Snipe-IT before a scan: its Status Labels' ids by name, and the Maintenance type
 *  for repairs with the Settings id it was looked up with. */
type RepairSetup = { labels: Record<string, number>; typeId: number | null; fallback: number | null }

/** The Maintenance type for repairs, looked up once per session and shared by Repair intake and Incoming repair (#60
 *  §1): looked up again while none is found, or when the Settings id it was looked up with changes. */
export function sharedRepairType(lookup: SnipeItBridge['repairTypeId']) {
  let kept: { fallback: number | null; id: Promise<number | null> } | null = null
  return {
    repairTypeId(fallback: number | null): Promise<number | null> {
      if (kept?.fallback === fallback) return kept.id
      const mine = { fallback, id: lookup(fallback) }
      kept = mine
      const forget = () => { if (kept === mine) kept = null }
      mine.id.then((id) => id === null && forget(), forget)
      return mine.id
    },
    /** Settings pointing at another server. */
    reset() {
      kept = null
    },
  }
}

// Repair intake and Incoming repair look up their Status Labels (by name, ignoring case) and the Maintenance type
// (#59 §3's fallback chain) when they open, and keep them for the session. What isn't found yet is looked for again at
// the next open; a type found is kept until the Settings id changes, which may be what the Operator just corrected.
function repairSetup(bridge: Pick<SnipeItBridge, 'statusLabels' | 'repairTypeId'>, names: string[], events: Events) {
  let setup: Promise<RepairSetup> | null = null
  let found: Partial<RepairSetup> = {}
  let blocked = ''
  // Bumped by reset, so a lookup for the old server never lands.
  let attempt = 0
  return {
    /** Why no scan is taken (a Status Label missing, or Snipe-IT couldn't be read), or ''. */
    get blocked() { return blocked },
    /** For a scan: what the last open looked up, once it's in. */
    get: () => setup ?? Promise.reject(new Error(noLabel(names[0]))),
    /** fallback: Settings' Maintenance type for repairs. */
    async open(fallback: number | null): Promise<void> {
      const typeKept = found.typeId != null && found.fallback === fallback
      if (found.labels && typeKept) return
      const mine = ++attempt
      const was = found
      const next = (async (): Promise<RepairSetup> => {
        let labels = was.labels
        if (!labels) {
          const all = await bridge.statusLabels()
          labels = {}
          for (const name of names) {
            const id = all.find((l) => l.name.trim().toLowerCase() === name.toLowerCase())?.id
            if (id === undefined) throw new Error(noLabel(name))
            labels[name] = id
          }
        }
        return { labels, typeId: typeKept ? was.typeId! : await bridge.repairTypeId(fallback), fallback }
      })()
      setup = next
      try {
        const s = await next
        if (mine !== attempt) return
        found = s
        blocked = ''
      } catch (e) {
        if (mine !== attempt) return
        blocked = (e as Error).message
      }
      events.changed()
    },
    reset() {
      attempt++
      setup = null
      found = {}
      blocked = ''
    },
  }
}

// Repair intake (#59): each scanned Asset is confirmed with what happened to it (required), then checked in as Damaged
// (or just marked Damaged if it isn't checked out), a repair Maintenance is opened, and a User who held it gets a User
// notes line. Each step after the first runs only once the first worked, and none undoes an earlier one.
export function createRepairIntake(bridge: Pick<SnipeItBridge, 'assetByTag' | 'checkin' | 'updateStatus' | 'addAssetNote' | 'statusLabels' | 'operatorName' | 'repairTypeId' | 'openMaintenances' | 'createMaintenance' | 'appendUserNotes'>, events: Events, now = () => new Date(), pace = PACE_MS) {
  const setup = repairSetup(bridge, [DAMAGED], events)
  // Bumped by reset: an intake still writing stops before its next step, which would go to the new server.
  let session = 0
  // "(by <Operator>)", read when the Workflow opens; failing, it's read again when a User notes line needs it.
  let operator: Promise<string> | null = null
  const operatorName = () => (operator ??= bridge.operatorName().catch((e) => { operator = null; throw e }))

  // The Maintenance step's sub-result.
  async function maintenance(a: Asset, typeId: number | null, notes: string, still: () => void): Promise<string> {
    if (typeId === null) return 'not opened: no Repair type found'
    try {
      if ((await bridge.openMaintenances(a.id)).some((m) => isRepair(m.type, typeId))) return 'already open'
      still()
      await bridge.createMaintenance({ assetId: a.id, typeId, name: `${a.assetTag} damaged`, startDate: localDate(now()), notes })
      return 'opened'
    } catch (e) {
      return `not opened: ${(e as Error).message}`
    }
  }

  const runner = createRunner<null>(bridge, async (a) => {
    const { labels: { [DAMAGED]: damaged }, typeId } = await setup.get()
    const held = a.assignee
    // Checked out, it's a Checkin; otherwise the Asset is edited (its Status Label and a note).
    if (held ? !a.can.checkin : !a.can.update) throw new Error(NOT_ALLOWED)
    // No confirm, so a second intake can't stack another note or Maintenance.
    if (!held && a.statusId === damaged) throw new Error('Already Damaged: nothing to do')
    const from = held && assigneeName(held)
    const user = held?.type === 'user' ? held : null
    const write = async (current: Asset, text: string): Promise<Done> => {
      if (current.assignee?.type !== held?.type || current.assignee?.id !== held?.id || current.statusId !== a.statusId) throw new Error(`${a.assetTag} changed since it was scanned`)
      const note = workflowNote('Repair intake', { text })
      const mine = session
      const still = () => { if (mine !== session) throw new Error('Stopped: Settings changed') }
      // No Location is sent, so a checked-in Asset goes back to its Default Location, as any Checkin from the app does.
      if (held) await bridge.checkin(a.id, { statusId: damaged, note })
      else await bridge.updateStatus(a.id, damaged)
      const sub: string[] = []
      still()
      if (!held) await bridge.addAssetNote(a.id, note).catch((e: Error) => sub.push(`Asset note not added: ${e.message}`))
      still()
      sub.push(`Maintenance ${await maintenance(a, typeId, note, still)}`)
      still()
      let copy: string | undefined
      if (!user) sub.push('User note: no User')
      else {
        try {
          const line = userNotesLine(localDate(now()), a.assetTag, text, await operatorName())
          // Offered whatever goes wrong from here; without the Operator's name there's no line to offer.
          copy = line
          still()
          await bridge.appendUserNotes(user.id, line)
          sub.push('User note added')
          copy = undefined
        } catch (e) {
          sub.push(`User note skipped: ${(e as Error).message}`)
        }
      }
      return { text: cleanText(text), what: held ? `Damaged, from ${from}` : "Damaged (wasn't checked out)", sub, copy }
    }
    const says = [
      held ? `Check in from ${from}, mark Damaged` : 'Mark Damaged, add the note to its History',
      typeId === null ? 'no Maintenance (no Repair type found)' : 'open a repair Maintenance',
      user && `add a line to ${user.name}'s notes`,
    ].filter(Boolean).join(', ')
    return { what: held ? `From ${from}` : "Wasn't checked out", confirm: { needs: 'Say what happened', says, write } }
  }, events, now, pace)

  return {
    runner,
    /** Why no scan is taken (no Damaged label, or Snipe-IT couldn't be read), or ''. */
    get blocked() { return setup.blocked },
    /** Opening the Workflow: looks up what it doesn't have yet. fallback: Settings' Maintenance type for repairs. */
    async open(fallback: number | null): Promise<void> {
      operatorName().catch(() => {})
      await setup.open(fallback)
    },
    scan: (raw: string) => setup.blocked || runner.scan(raw, null),
    /** Settings were saved: a new API token on the same server may be another Operator, so "(by …)" is read again. */
    forgetOperator() {
      operator = null
    },
    reset() {
      session++
      setup.reset()
      operator = null
      runner.reset()
    },
  }
}
export type RepairIntake = ReturnType<typeof createRepairIntake>

const newest = (list: OpenMaintenance[]) => list.reduce<OpenMaintenance | null>((n, m) => (n && n.id > m.id ? n : m), null)
/** What an Incoming repair scan was made under: the "Repaired by" Supplier then. Once its confirm or choice opens, also
 *  what the scan found (the newest open Repair Maintenance, how many others, the Repair type id, and whether it counts
 *  as Damaged) and the Repair cost typed there, as typed. */
export type IncomingCtx = { supplier: StatusLabel | null; cost: string; found?: { open: OpenMaintenance | null; others: number; typeId: number | null; damaged: boolean } }
// A Repair cost as typed: '' when none, else `45.00`; throws with a message when it isn't a number.
const costOf = (raw: string) => (raw.trim() ? repairCost(raw) : '')
const wrong = (f: () => unknown) => { try { return f(), '' } catch (e) { return (e as Error).message } }
// "(Acme Device Repair, $45.00)", or '' with neither.
const given = (supplier: StatusLabel | null, cost: string) => {
  const g = [supplier?.name, cost && `$${cost}`].filter(Boolean).join(', ')
  return g && ` (${g})`
}
const backFrom = (supplier: StatusLabel | null, cost: string) => `Back from repair${given(supplier, cost)}`
// The Maintenance step (#60 §1): close the open one, create one and close it (only when a Supplier or Repair cost was
// given), or, with no Repair type to create one with, put the Supplier and Repair cost in the note so nothing typed is
// lost. An Asset made ready anyway (not Damaged) may never have gone for repair, so there the header's Supplier alone
// records nothing; a Repair cost typed for it does.
type Plan = 'close' | 'create' | 'note' | 'none'
function planOf({ supplier, cost, found }: IncomingCtx): { plan: Plan; supplier: StatusLabel | null; cost: string } {
  const { open, typeId, damaged } = found!
  const c = wrong(() => costOf(cost)) ? '' : costOf(cost)
  // The Maintenance's own Supplier is kept; the header's fills one that has none.
  const s = open?.supplier ?? supplier
  return { plan: open ? 'close' : !c && !(s && damaged) ? 'none' : typeId === null ? 'note' : 'create', supplier: s, cost: c }
}

// Incoming repair (#60): pick who repaired them once ("Repaired by"), then each scanned Asset is confirmed (with an
// optional Repair cost and note), made Ready to Deploy, its return noted in History, and its open Repair Maintenance
// closed with the Supplier and cost. Nothing after the status change undoes it.
export function createIncomingRepair(
  bridge: Pick<SnipeItBridge, 'assetByTag' | 'updateStatus' | 'addAssetNote' | 'statusLabels' | 'repairTypeId' | 'openMaintenances' | 'maintenance' | 'createMaintenance' | 'updateMaintenance' | 'completeMaintenance' | 'deleteMaintenance' | 'supplierSelectlist'>,
  events: Events, now = () => new Date(), pace = PACE_MS,
) {
  const setup = repairSetup(bridge, [DAMAGED, READY], events)
  let supplier: StatusLabel | null = null
  // Bumped by reset: a return still writing stops before its next step, which would go to the new server.
  let session = 0
  const sameSession = (mine: number) => {
    if (mine !== session) throw new Error('Stopped: Settings changed')
  }
  const next = (): IncomingCtx => ({ supplier, cost: '' })

  const runner = createRunner<IncomingCtx>(bridge, async (a, ctx) => {
    const { labels: { [DAMAGED]: damaged, [READY]: ready }, typeId } = await setup.get()
    if (a.assignee) throw new Error(`Checked out to ${assigneeName(a.assignee)}, so it can't be back from repair. Use Bulk return or Repair intake.`)
    if (a.statusType === 'archived') throw new Error(`${a.assetTag} is Archived, so it can't be back from repair`)
    if (!a.can.update) throw new Error(NOT_ALLOWED)
    const openRepairs = async () => (await bridge.openMaintenances(a.id)).filter((m) => isRepair(m.type, typeId))
    const repairs = await openRepairs()
    // The newest is closed: Snipe-IT's ids grow with each new Maintenance.
    const open = newest(repairs)
    if (a.statusId === ready && !open) throw new Error('Already ready: nothing to do')
    // Another status with an open Repair Maintenance counts as Damaged: someone changed the label by hand.
    const isDamaged = a.statusId === damaged || !!open
    ctx.found = { open, others: Math.max(0, repairs.length - 1), typeId, damaged: isDamaged }

    const write = async (current: Asset, text: string): Promise<Done> => {
      if (current.assignee || current.statusId !== a.statusId) throw new Error(`${a.assetTag} changed since it was scanned`)
      // Taken before the re-read, so Settings pointing at another server meanwhile stops it before the first write.
      const mine = session
      const still = () => sameSession(mine)
      // Its Maintenances are read again, so a Supplier or Repair cost someone set on it since the scan is never overwritten.
      const fresh = newest(await openRepairs())
      if (fresh?.id !== open?.id || fresh?.supplier?.id !== open?.supplier?.id || fresh?.cost !== open?.cost) throw new Error(`${a.assetTag}'s Maintenance changed since it was scanned`)
      const { plan, supplier: s, cost } = planOf(ctx)
      // Built first, so a link in it refuses before anything is written.
      const note = workflowNote('Incoming repair', plan === 'note' ? { text, supplier: s?.name, cost: cost || undefined } : { text })
      still()
      await bridge.updateStatus(a.id, ready)
      still()
      // "Ready, but <step> failed: <reason>" (#60 §2).
      const failed: string[] = []
      await bridge.addAssetNote(a.id, note).catch((e: Error) => failed.push(`the note failed: ${e.message}`))
      still()
      // What the undo puts back: the Maintenance's fields it changed, whether it closed it, or the one it created.
      const change: { supplierId?: number; cost?: string } = {}
      const madeOn = localDate(now())
      const madeNotes = workflowNote('Incoming repair', { text: 'No Repair intake record' })
      let closed = false
      let created: number | null = null
      const sub: string[] = []
      if (plan === 'close') {
        try {
          if (s && !open!.supplier) change.supplierId = s.id
          if (cost) change.cost = cost
          if (Object.keys(change).length) await bridge.updateMaintenance(open!.id, change)
          still()
          await bridge.completeMaintenance(open!.id, note)
          closed = true
          sub.push('Maintenance closed')
        } catch (e) {
          sub.push('Maintenance not closed')
          failed.push(`the Maintenance failed: ${(e as Error).message}`)
        }
        const n = ctx.found!.others
        if (n) sub.push(`${n} other open Maintenance${n === 1 ? '' : 's'} left as is`)
      } else if (plan === 'create') {
        try {
          created = await bridge.createMaintenance({
            assetId: a.id, typeId: typeId!, name: `${a.assetTag} repair`, startDate: madeOn, notes: madeNotes,
            ...(s && { supplierId: s.id }), ...(cost && { cost }),
          })
          still()
          await bridge.completeMaintenance(created, note)
          sub.push('Maintenance created and closed')
        } catch (e) {
          sub.push(`Maintenance ${created === null ? 'not written' : 'created, not closed'}`)
          failed.push(`the Maintenance failed: ${(e as Error).message}`)
        }
      } else sub.push(plan === 'note' ? 'Maintenance not written: no Repair type found' : 'No Maintenance (nothing to record)')

      // Undo: the old Status Label and an undo note, then the Maintenance as it was. Only a failed status change stops it.
      const run = async (now: Asset): Promise<string> => {
        if (now.assignee) throw new Error(`${a.assetTag} is checked out to ${assigneeName(now.assignee)} now`)
        // A label someone set since the return isn't overwritten with the old one.
        if (now.statusId !== ready) throw new Error(`${a.assetTag} is '${now.status}' now`)
        if (!now.can.update) throw new Error(NOT_ALLOWED)
        const mine = session
        await bridge.updateStatus(a.id, a.statusId!)
        sameSession(mine)
        const notBack: string[] = []
        await bridge.addAssetNote(a.id, undoNote('Incoming repair')).catch((e: Error) => notBack.push(`the note failed: ${e.message}`))
        sameSession(mine)
        const touched = closed || Object.keys(change).length > 0
        if (touched || created !== null) {
          // Read again first: a Supplier or Repair cost someone corrected since the return is never overwritten or deleted.
          const id = created ?? open!.id
          const wrote = created !== null
            ? { supplier: s?.id ?? null, cost: cost || null, type: typeId, startDate: madeOn, notes: madeNotes }
            : { supplier: change.supplierId ?? open!.supplier?.id ?? null, cost: change.cost ?? open!.cost, type: open!.type?.id ?? null, startDate: open!.startDate, notes: open!.notes }
          try {
            const m = await bridge.maintenance(id)
            sameSession(mine)
            if ((m.supplier?.id ?? null) !== wrote.supplier || m.cost !== wrote.cost || (m.type?.id ?? null) !== wrote.type || m.startDate !== wrote.startDate || m.notes !== wrote.notes) throw new Error('it was changed since the return, so it was left as is')
            if (created !== null) await bridge.deleteMaintenance(created)
            else await bridge.updateMaintenance(open!.id, { ...('supplierId' in change && { supplierId: open!.supplier?.id ?? null }), ...('cost' in change && { cost: open!.cost }), ...(closed && { reopen: true }) })
          } catch (e) {
            notBack.push(`the Maintenance wasn't ${created !== null ? 'deleted' : closed ? 'reopened' : 'put back'}: ${(e as Error).message}`)
          }
        }
        return notBack.join('; ')
      }
      const says = `${a.assetTag} made Ready to Deploy${closed ? ', its Maintenance closed' : created !== null ? ', a Maintenance created' : ''}`
      return { text: `Ready${failed.length ? `, but ${failed.join('; ')}` : ''}`, what: backFrom(plan === 'none' ? null : s, cost), sub, undo: { says, run } }
    }

    // The header's Supplier shows only where it will be recorded.
    const what = backFrom(isDamaged ? (open?.supplier ?? ctx.supplier) : null, '')
    // A link in the note, or a Repair cost that isn't a number, keeps it open.
    const check = (text: string) => wrong(() => (workflowNote('Incoming repair', { text }), costOf(ctx.cost)))
    if (isDamaged) return { what, confirm: { check, write } }
    return { what, choice: { fix: 'Make ready anyway', blocked: '', stop: 'not Damaged', check, write } }
  }, events, now, pace)

  const openCtx = () => runner.open?.row.ctx

  return {
    runner,
    /** Why no scan is taken (Damaged or Ready to Deploy missing, or Snipe-IT couldn't be read), or ''. */
    get blocked() { return setup.blocked },
    /** "Repaired by": the Supplier for Assets scanned from now on, or null. */
    get supplier() { return supplier },
    setSupplier(s: StatusLabel | null) {
      supplier = s
      events.changed()
    },
    /** Snipe-IT's Supplier picker list. ponytail: its first 50 by name, no search; a school has a few repair Suppliers. */
    suppliers: () => bridge.supplierSelectlist(''),
    /** Opening the Workflow: looks up what it doesn't have yet. fallback: Settings' Maintenance type for repairs. */
    open: (fallback: number | null) => setup.open(fallback),
    scan: (raw: string) => setup.blocked || runner.scan(raw, next()),
    /** The open confirm's or choice's Maintenance found, and how many other open ones there are; or null. */
    get found() { return openCtx()?.found ?? null },
    /** What the open confirm or choice will write, with the Repair cost typed so far; or null. */
    get says() {
      const ctx = openCtx()
      if (!ctx) return null
      const { plan, supplier: s, cost } = planOf(ctx)
      const g = given(s, cost)
      const step = {
        close: `, close the repair Maintenance${g}`,
        create: `, create and close a repair Maintenance${g}`,
        note: ` with the ${[s && 'Supplier', cost && 'Repair cost'].filter(Boolean).join(' and ')} (no Repair type found for a Maintenance)`,
        none: ', no Maintenance (nothing to record)',
      }[plan]
      return `Make Ready to Deploy, note the return${step}`
    },
    /** The open confirm's or choice's Repair cost, as typed. */
    get cost() { return openCtx()?.cost ?? '' },
    setCost(raw: string) {
      const ctx = openCtx()
      if (ctx) ctx.cost = raw
      events.changed()
    },
    /** Enter in the Repair cost field: a number (or nothing) confirms; anything else may be a scan that landed there, so
     *  it's checked as an Asset Tag, and kept with the confirm when it isn't one. Returns what the status line says. */
    async submitCost(raw: string): Promise<string> {
      const ctx = openCtx()
      if (!ctx) return ''
      ctx.cost = raw
      const bad = wrong(() => costOf(raw))
      if (!bad) return runner.confirmOpen()
      return (await runner.typedTag(raw, next(), () => (ctx.cost = ''))) ?? bad
    },
    /** Enter in the Note field: the shell's one-word Asset Tag check, then it confirms. */
    submitNote: (raw: string) => runner.submitText(raw, next()),
    reset() {
      session++
      supplier = null
      setup.reset()
      runner.reset()
    },
  }
}
export type IncomingRepair = ReturnType<typeof createIncomingRepair>
