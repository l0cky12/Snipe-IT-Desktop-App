// The Workflows shell (#56): each Workflow's scan queue and Running list, and the Workflows built on it.
// No React here: App keeps one of each Workflow for the session and re-renders on changed(); Snipe-IT is reached only
// through the bridge passed in, so the tests drive it with a fake.
import type { Asset, Assignee, CheckoutOptions, Failure, SnipeItBridge, StatusLabel, UserCard } from '../../main/snipeit'
import { dueAt, dueLabel, realDate, realTime, stamp, type SchoolTimes } from '../../main/calendar'
import { localDate } from '../../main/export'
import { cleanText, parseWorkflowNote, undoNote, userNotesLine, workflowNote } from '../../main/notes'
import type { Outcome } from './ListView'

// Why an action is off when Snipe-IT says the Operator's key may not do it.
export const NOT_ALLOWED = "Your Snipe-IT account isn't allowed to do this"

/** A Running list row's result: a Bulk Action's outcome states, plus waiting its turn in the queue, open in a confirm or a
 *  choice, put back by Undo last, neutral (nothing written, nothing wrong: "Already theirs", "Skipped: not confirmed"),
 *  and a write that may have gone through before the connection dropped (unsure, waiting for Resume to check). Refused,
 *  failed and stopped are all 'failed'. */
export type Result = { state: 'waiting' } | { state: 'confirm' } | { state: 'choice' } | { state: 'undone' } | { state: 'neutral'; text: string } | { state: 'unsure'; reason: string } | Outcome
/** How Undo last puts a done row back. says: what was done, for the confirm. run: the opposite Snipe-IT action, given the
 *  Asset as it is now; it throws, saying what it found, when the Asset is no longer as the Workflow left it. current: false
 *  once Settings points at another server; after each of its own awaits, run writes nothing more unless it's still true.
 *  It may resolve to the Undone row's sub-results (a later step that failed doesn't stop it being Undone). */
export type Undo = { says: string; run: (now: Asset, current: () => boolean) => Promise<void | string[]> }
/** One scan in a Running list. ctx is what the Workflow was set to when it was scanned (Bulk return: the Location).
 *  before: the Asset as the lookup found it, before the Workflow acted. undo: how to put it back, or why it can't be.
 *  undoFailed: why the last Undo of it didn't happen. */
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
/** A Workflow's write to Snipe-IT, run in the Asset's turn. write: the action, given the Asset just looked up (or re-read)
 *  and the text typed; it throws to refuse. left: after a write that may not have gone through, the Done it would have
 *  given if the Asset re-read now is already as this Workflow leaves it (Undo last's guard test), else null. A write of
 *  several steps finishes the ones after its first there, given the text typed: they were never sent. */
export type Write = { write: (now: Asset, text: string) => Promise<Done>; left?: (now: Asset, text: string) => Done | null | Promise<Done | null> }
/** A confirm step (#56 §3): its Write, run once confirmed. needs: when it has text it can't go without, what the status
 *  line says while that's empty ("Say what happened"). says: what will be written, for the card. */
export type Confirm = Write & { needs?: string; says?: string }
/** A choice step (#56 §3): an Asset that can't go through as scanned, and its Write, the fix-it action, run once picked.
 *  fix: the fix-it button's label; blocked: why it's off ('' when it isn't); stop: what's in the way, for "Stopped: <stop>".
 *  Only an explicit pick runs it: Enter and a same-tag rescan never do. */
export type Choice = Write & { fix: string; blocked: string; stop: string }
/** What a Workflow's step does to one scanned Asset: done at once, a neutral row, a confirm or choice first, or a write
 *  sent at once (send); or a throw with the refusal. Only the Write is sent again or checked after a pause. */
export type Act<C> = (asset: Asset, ctx: C) => Promise<Done | { neutral: string; what?: string } | { confirm: Confirm; what?: string } | { choice: Choice; what?: string } | { send: Write }>
export const SKIPPED = 'Skipped: not confirmed'
export const NOT_SENT = 'Skipped: not sent'
export const NOT_SURE = 'Not sure it went through'

/** Why a Workflow is Paused (#73): Snipe-IT can't be reached (or timed out), rejected the key, or asked the app to slow
 *  down (until: when it carries on by itself). */
export type Pause = { kind: 'unreachable' | 'key'; message: string } | { kind: 'rateLimited'; message: string; until: number }
/** The pause bar's text, with the waiting count (and for a slow-down, the seconds left at `now`). */
export function pauseSays(p: Pause, waiting: number, now = Date.now()) {
  const n = `${waiting} scan${waiting === 1 ? ' is' : 's are'} waiting`
  if (p.kind !== 'rateLimited') return `${p.message} ${n}; nothing more is sent until you resume.`
  return `Snipe-IT asked the app to slow down. Carrying on in ${Math.max(0, Math.ceil((p.until - now) / 1000))} s. ${n}.`
}
// A slow-down with no readable Retry-After waits Snipe-IT's throttle window.
const SLOW_DOWN_S = 60

const hhmm = (d: Date) => d.toTimeString().slice(0, 5)
// What a scanner or a stray key adds around an Asset Tag: control characters anywhere, whitespace at the ends.
export const cleanTag = (raw: string) => raw.replace(/\p{Cc}/gu, '').trim()
const busy = (r: Row) => r.result.state === 'waiting' || r.result.state === 'working' || r.result.state === 'unsure'
// The fields a Workflow's write changes (or its undo puts back); an Asset whose fields all match its lookup is as it was when scanned.
// lastCheckout tells a newer Checkout to the same Assignee, with the same fields, from the one that was looked up.
const same = (a: Asset, b: Asset) =>
  a.assignee?.type === b.assignee?.type && a.assignee?.id === b.assignee?.id && a.statusId === b.statusId && a.locationId === b.locationId && a.expectedCheckin === b.expectedCheckin
  && a.lastCheckout === b.lastCheckout
export const assigneeName = (a: Assignee) => `${a.type === 'asset' ? 'Asset ' : ''}${a.name}`
const found = (a: Asset) => `${a.assignee ? `checked out to ${assigneeName(a.assignee)}` : 'not checked out'}, '${a.status || 'no status'}', at ${a.location || 'no Location'}`

// The least time between one queued Asset starting and the next: a Bulk return is 3 requests, so 1.5s keeps a fast
// scanner under Snipe-IT's default 120 requests a minute instead of turning the rest of the queue into throttled rows.
// ponytail: fixed pace per Workflow; a 429 anyway (say, two Workflows at once) pauses the queue until Retry-After.
export const PACE_MS = 1500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One Workflow's queue and Running list. Scans queue and run one at a time in order (like a Bulk Action's eachInTurn, for a list
// that keeps growing); a refusal doesn't stop the next, a session-wide failure pauses the queue (#73). In memory only:
// never saved or exported, like Recent scans. refresh: the once-per-session lookups, run again on Resume.
// ponytail: one request in flight per Workflow; 2–3 requests per Asset stays well inside Snipe-IT's 120 a minute.
export function createRunner<C>(bridge: Pick<SnipeItBridge, 'assetByTag' | 'keyRefused'>, act: Act<C>, events: Events, now = () => new Date(), pace = PACE_MS, refresh?: () => Promise<void>) {
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
  // unsure: why a write that was sent may not have gone through; Resume checks the Asset before sending it again.
  const writes = new Map<number, { write: Write; text: string; unsure?: string }>()
  // Off the Workflow's page: a confirm that would open is skipped, so nothing waits for an Operator who isn't looking.
  let away = false
  let paused: Pause | null = null
  // The rows that waited through a pause (by key): on Resume, each one's confirm comes up only once the one before is answered.
  const held = new Set<number>()
  let slowDown: ReturnType<typeof setTimeout> | undefined

  const update = (key: number, change: Partial<Row<C>>) => {
    rows = rows.map((r) => (r.key === key ? { ...r, ...change } : r))
    events.changed()
  }
  const settle = (row: Row<C>, result: Outcome | { state: 'neutral'; text: string }, change: Partial<Row<C>> = {}) => {
    announce = `${row.tag}: ${result.state === 'failed' ? result.reason : result.state === 'working' ? '' : result.text}`
    update(row.key, { ...change, result })
    if (result.state === 'failed') events.failed?.()
  }

  // Whether a failure is about the session rather than this Asset, and the pause it calls for. A 403 is about the key
  // only when /version, which needs no permission, is refused too.
  async function pauseFor(e: unknown): Promise<Pause | null> {
    const { kind, message = String(e), retryAfter } = (e ?? {}) as Partial<Failure>
    if (kind === 'unreachable' || kind === 'timeout') return { kind: 'unreachable', message }
    if (kind === 'key') return { kind, message }
    if (kind === 'rateLimited') return { kind, message, until: Date.now() + (retryAfter ?? SLOW_DOWN_S) * 1000 }
    if (kind === 'forbidden' && (await bridge.keyRefused().catch(() => false))) return { kind: 'key', message }
    return null
  }
  // Every row still in the queue waited through this pause. One error sound, not one per waiting scan.
  function pause(p: Pause) {
    paused = p
    queue.forEach((r) => held.add(r.key))
    announce = pauseSays(p, queue.length)
    // A slow-down carries on by itself; nothing was written by the refused request.
    if (p.kind === 'rateLimited') slowDown = setTimeout(() => resume(), p.until - Date.now())
    events.changed()
    events.failed?.()
  }

  async function drain() {
    if (running) return
    running = true
    const mine = generation
    // Paused, nothing is sent. After a pause, the next held scan waits for the open confirm, so each comes up in turn.
    while (queue.length && !paused && !(opened && held.has(queue[0].key))) {
      const row = queue.shift()!
      const wasHeld = held.delete(row.key)
      if (undoing) await undoing
      const wait = lastStart + pace - Date.now()
      if (wait > 0) await sleep(wait)
      if (mine !== generation) return
      lastStart = Date.now()
      const pending = writes.get(row.key)
      writes.delete(row.key)
      update(row.key, { result: { state: 'working' } })
      // The write being sent; a failure while sending it may mean it went through.
      let sending: typeof pending = undefined
      const send = async (asset: Asset, p: NonNullable<typeof pending>) => {
        sending = p
        const { text, what = row.what, undo, sub, copy } = await p.write.write(asset, p.text)
        sending = undefined
        if (mine !== generation) return
        settle(row, { state: 'done', text }, { what, undo, sub, copy })
      }
      try {
        const asset = await bridge.assetByTag(row.tag)
        if (mine !== generation) return
        if (pending) {
          // The confirm (or the pause) gave the Asset time to change; the write only ever touches the Asset that was scanned.
          const { assetId, before } = rows.find((r) => r.key === row.key)!
          if (asset?.id !== assetId) throw new Error(asset ? `${row.tag} is another Asset's tag now` : `No Asset with tag ${row.tag} now`)
          if (pending.unsure) {
            // Checked, never sent twice: already as this Workflow leaves it is done; unchanged is sent again; else refused.
            const done = await pending.write.left?.(asset, pending.text)
            if (mine !== generation) return
            if (done) {
              settle(row, { state: 'done', text: `${done.text}: went through before the connection dropped` }, { what: done.what ?? row.what, undo: done.undo, sub: done.sub, copy: done.copy })
              continue
            }
            if (!before || !same(before, asset)) throw new Error(`Changed while paused: ${found(asset)}`)
          }
          await send(asset, pending)
          continue
        }
        if (!asset) {
          settle(row, { state: 'failed', reason: `No Asset with tag ${row.tag}` })
          continue
        }
        update(row.key, { assetId: asset.id, name: asset.name || asset.model, before: asset })
        const step = await act(asset, row.ctx)
        if (mine !== generation) return
        if ('send' in step) await send(asset, { write: step.send, text: '' })
        else if ('confirm' in step || 'choice' in step) {
          // At most one open: a newer one skips or stops the one still waiting, as a different scan would. Latest wins: a
          // newer scan (or line) since this one, whatever came of it, means this confirm or choice never opens. Not for a
          // scan that waited through a pause: those come up in turn on Resume.
          skipOpen()
          const shut = 'choice' in step ? stopped(step.choice) : ({ state: 'neutral', text: SKIPPED } as const)
          if (away || (!wasHeld && row.key !== next)) settle(row, shut, { what: step.what ?? '' })
          else {
            opened = 'choice' in step ? { key: row.key, choice: step.choice, text: '' } : { key: row.key, confirm: step.confirm, text: '' }
            update(row.key, { what: step.what ?? '', result: { state: 'choice' in step ? 'choice' : 'confirm' } })
          }
        } else if ('neutral' in step) settle(row, { state: 'neutral', text: step.neutral }, { what: step.what ?? '' })
        else settle(row, { state: 'done', text: step.text }, { what: step.what ?? '', undo: step.undo })
      } catch (e) {
        if (mine !== generation) return
        const p = await pauseFor(e)
        if (mine !== generation) return
        if (!p) {
          settle(row, { state: 'failed', reason: (e as Error).message })
          continue
        }
        // The scan goes back to the front. A write that lost the connection or timed out may have gone through; a 401,
        // 403 or 429 is refused before Snipe-IT changes anything, and a failed read wrote nothing.
        const sent = sending as typeof pending
        const back = sent && p.kind === 'unreachable' ? { ...sent, unsure: sent.unsure ?? p.message } : pending
        if (back) writes.set(row.key, back)
        queue.unshift(row)
        update(row.key, { result: back?.unsure ? { state: 'unsure', reason: back.unsure } : { state: 'waiting' } })
        pause(p)
      }
    }
    running = false
  }

  // When the slow-down ends, or byHand: then the once-per-session lookups run again first (the key may have changed).
  async function resume(byHand = false) {
    if (!paused) return
    clearTimeout(slowDown)
    const was = paused
    const mine = generation
    if (byHand && refresh) {
      try {
        await refresh()
      } catch (e) {
        const p = await pauseFor(e)
        // Drop waiting or another server while the lookups ran: that pause is over.
        if (mine !== generation || paused !== was) return
        return pause(p ?? { ...was, message: (e as Error).message } as Pause)
      }
      if (mine !== generation || paused !== was) return
    }
    paused = null
    events.changed()
    drain()
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
    // The next held scan's turn.
    drain()
  }
  // The open step's write joins the queue.
  function queueWrite(write: Write, text: string) {
    const row = openRow()!
    opened = null
    writes.set(row.key, { write, text })
    // Ahead of scans held by a pause: it was scanned before them.
    queue.unshift(row)
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
    queueWrite(confirm!, text.trim())
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
    if (paused) return 'Undo waits until the Workflow resumes'
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
    /** Why the queue is Paused, or null. */
    get paused() { return paused },
    /** Scans a pause is keeping from Snipe-IT, for the quit prompt; 0 while the queue moves. */
    get unsent() { return paused ? rows.filter(busy).length : 0 },
    /** Resume: the scan that hit the failure goes first. */
    resume: () => resume(true),
    /** Drop waiting: every waiting scan is "Skipped: not sent", nothing written, and the pause lifts. A write that may have
     *  gone through says so, for the Operator to check. */
    dropWaiting() {
      if (!paused) return
      clearTimeout(slowDown)
      paused = null
      for (const r of queue) {
        const unsure = writes.get(r.key)?.unsure
        update(r.key, { result: unsure ? { state: 'failed', reason: `${NOT_SURE}: ${unsure}` } : { state: 'neutral', text: NOT_SENT } })
      }
      queue = []
      writes.clear()
      held.clear()
      announce = 'Waiting scans dropped'
      events.changed()
    },
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
      if (opened.choice.blocked) return opened.choice.blocked
      queueWrite(opened.choice, '')
      return ''
    },
    /** Esc, Done or leaving: the open confirm's Asset is skipped, or the open choice's stopped; never written. */
    cancelOpen: skipOpen,
    /** Enter in a confirm's text field. One word is checked as an Asset Tag first, and is a scan of it if it is one;
     *  anything else is the text, and confirms. Returns what the status line should say. */
    async submitText(raw: string, ctx: C): Promise<string> {
      const key = opened?.key
      const word = cleanTag(raw)
      if (key && word && !/\s/.test(word)) {
        const asset = await bridge.assetByTag(word).catch((e: Error) => e)
        // Esc, another scan or leaving while it was looked up: this text no longer belongs to the confirm.
        if (opened?.key !== key) return ''
        // It may have been a scan, so it never becomes the text unchecked (onChange already stored it); the confirm stays open.
        if (asset instanceof Error) return (opened.text = ''), `Couldn't check whether ${word} is an Asset Tag: ${asset.message}`
        // The text was the tag, so nothing has been said yet.
        if (asset) return (opened.text = ''), this.scan(word, ctx)
      }
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
        const sub = await run(now, () => mine === generation)
        if (mine !== generation) return
        announce = `${row.tag}: Undone`
        update(row.key, { result: { state: 'undone' }, undoFailed: undefined, ...(sub && { sub, copy: undefined }) })
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
      // Paused, it waits with no lookup; its confirm comes up on Resume.
      const row: Row<C> = { key: ++next, time: hhmm(now()), tag, assetId: null, name: '', what: '', ctx, result: { state: 'waiting' }, before: null }
      if (paused) held.add(row.key)
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
      paused = null
      held.clear()
      clearTimeout(slowDown)
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
export function createBulkReturn(bridge: Pick<SnipeItBridge, 'assetByTag' | 'keyRefused' | 'checkin' | 'checkout' | 'statusLabels' | 'getAsset'>, events: Events, now = () => new Date(), pace = PACE_MS) {
  let step: BulkReturnStep = { step: 'location' }
  // The Location picked last, highlighted when the next round starts.
  let last: StatusLabel | null = null
  // "Ready to Deploy", found by exact name once per session.
  let ready: number | undefined
  // Bumped by every start, Done and reset, so a start still finding the label never lands after a newer pick or after leaving.
  let attempt = 0
  const findReady = async () => (await bridge.statusLabels()).find((l) => l.name === READY)?.id

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
    // Undo: a Checkout back to the same Assignee with the old Status Label and Expected Checkin. Snipe-IT's Checkout sets
    // the Location; the old one isn't forced back. A Temp checkout is made one again (its tag back), but a time of day alone
    // doesn't make one: an ordinary Checkout can have one too. So History says, only then: its newest Checkout is the one
    // returned (it's still checked in, as left). History that can't be read puts back an ordinary Checkout.
    const readyId = ready
    const run = async (now: Asset, current: () => boolean) => {
      if (now.assignee) throw new Error(`${now.assetTag} is checked out to ${now.assignee.name} now`)
      // A label someone set since the return isn't overwritten with the old one; Checkout's own last read checks it again.
      if (now.statusId !== readyId) throw new Error(`${now.assetTag} is '${now.status}' now`)
      let due: string | undefined
      if (expectedCheckin && expectedCheckin.length > 10) {
        const n = parseWorkflowNote((await bridge.getAsset(a.id)).history.find((h) => h.action === 'Checkout')?.note ?? null)
        if (!current()) return
        if (n && (n.undo ? n.due : n.workflow === 'Temp checkout')) due = expectedCheckin
      }
      await bridge.checkout(a.id, { targetType: was.type, targetId: was.id, statusId: statusId ?? undefined, fromStatusId: readyId, expectedCheckin: expectedCheckin ?? undefined, note: undoNote('Bulk return', due) })
    }
    // Snipe-IT checks out only an Asset whose Status Label is deployable, so a kept label can't be undone from the list.
    const undo = keep ? `Snipe-IT can't check out an Asset with status '${a.status}'. Open ${a.assetTag} to put it back by hand.` : { says: `${a.assetTag} checked in from ${from}`, run }
    const done: Done = { text: keep ? `Kept status '${a.status}'` : 'Checked in', what: `From ${from}`, undo }
    return {
      send: {
        write: async () => (await bridge.checkin(a.id, { statusId: keep ? undefined : readyId, locationId: location.id, note: workflowNote('Bulk return') }), done),
        left: (now) => (!now.assignee && now.statusId === (keep ? statusId : readyId) && now.locationId === location.id ? done : null),
      },
    }
  }, events, now, pace, async () => {
    // Resume: found again, in case it's another key now. ponytail: kept as it was if it's gone; the next Checkin says why.
    // Not after Done or another server meanwhile (attempt moved): reset() forgets it, and the next start finds it.
    const mine = attempt
    const id = await findReady()
    if (mine === attempt) ready = id ?? ready
  })

  return {
    runner,
    get step() { return step },
    get last() { return last },
    /** Starts step 2 at this Location; returns why it can't ('' when it did). */
    async start(location: StatusLabel): Promise<string> {
      const mine = ++attempt
      if (ready === undefined) {
        const id = await findReady()
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
// Changes on a new step or round only, not when the User's Asset count does, so the view's field clears on a real change.
export const fieldKey = (s: BulkCheckoutStep) => (s.step === 'scan' ? `scan ${s.round}` : s.step)
/** Bulk checkout's Options: a date-only Expected Checkin and a note, each '' when not set. Temp checkout uses only the
 *  note; its Expected Checkin is always the due time. */
export type CheckoutSession = { expectedCheckin: string; note: string }
/** What a Bulk checkout scan was made under: the User, which round with them, and the Options. */
export type CheckoutCtx = CheckoutSession & { user: UserCard; round: number }
const NO_OPTIONS: CheckoutSession = { expectedCheckin: '', note: '' }

export const NO_SCHOOL_DAY = 'No School day in the next year. Check the School calendar in Settings.'
type CheckoutBridge = Pick<SnipeItBridge, 'assetByTag' | 'keyRefused' | 'checkin' | 'checkout' | 'getAsset' | 'exactUsers' | 'userSelectlist' | 'userCard'>

// Bulk checkout (#57): find the User, then each scanned Asset is checked, confirmed and checked out to them until Done.
// Someone else's Asset opens a choice instead: Move to this User, or Stop.
export const createBulkCheckout = (bridge: CheckoutBridge, events: Events, now = () => new Date(), pace = PACE_MS) =>
  checkoutFlow('Bulk checkout', bridge, events, now, pace)

// Temp checkout (#61 §7): Bulk checkout's steps, each Checkout due back at the end-of-day time (worked out as it's
// written, from times(): the Settings as they are then), or at the time the Operator changed it to for this User.
export const createTempCheckout = (bridge: CheckoutBridge, events: Events, times: () => SchoolTimes, now = () => new Date(), pace = PACE_MS) =>
  checkoutFlow('Temp checkout', bridge, events, now, pace, times)

function checkoutFlow(workflow: 'Bulk checkout' | 'Temp checkout', bridge: CheckoutBridge, events: Events, now: () => Date, pace: number, times?: () => SchoolTimes) {
  let step: BulkCheckoutStep = { step: 'user' }
  // Temp checkout: the due time the Operator set, by the round (User) it was set in, kept so a write still queued after
  // Done or another User gets its own round's; a new round starts without one. ponytail: one entry per round, all session.
  const dueSets = new Map<number, string>()
  // Temp checkout: the due time a Checkout in this round gets if written now, or null when the School calendar leaves none.
  const dueFor = (r?: number) => (!times ? null : (r !== undefined && dueSets.get(r)) || dueAt(now(), times()))
  // Temp checkout: "Temp, due 2:50 pm"; Bulk checkout: "To <User>".
  const whatFor = (user: UserCard, due: string | null) => (!times ? `To ${user.name}` : due ? `Temp, due ${dueLabel(due, now(), true)}` : 'Temp')
  let options = NO_OPTIONS
  let round = 0
  // Bumped by every find, Done and reset, so a slower find never lands after a newer one or after Done.
  let attempt = 0
  // Bumped by reset (Settings pointing at another server): a Checkout or Undo still in flight never counts on the new
  // server, and a two-call write stops before its second call, which would go there with the old server's ids.
  let session = 0
  // The header's "holds N Assets" follows each Checkout and Undo while that User is still the one being served.
  const held = (userId: number, by: number, from: number) => {
    if (from === session && step.step === 'scan' && step.user.id === userId) step = { ...step, user: { ...step.user, assets: step.user.assets + by } }
  }
  const sameSession = (mine: number) => {
    if (mine !== session) throw new Error('Stopped: Settings changed')
  }

  const runner = createRunner<CheckoutCtx>(bridge, async (a, { user, round, expectedCheckin, note }) => {
    const what = whatFor(user, dueFor(round))
    const mine = session
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
    // Undo's guard: it's still checked out to this User, on the Checkout this row wrote as far as the Asset can tell (the
    // Expected Checkin it sent). ponytail: a replacement Checkout with the same Expected Checkin passes; Asset has no Checkout id.
    const stillTheirs = (now: Asset, sent: string) => {
      if (now.assignee?.type !== 'user' || now.assignee.id !== user.id) throw new Error(`${a.assetTag} is no longer checked out to ${user.name}`)
      if ((now.expectedCheckin ?? '') !== sent) throw new Error(`${a.assetTag} was checked out to ${user.name} again since`)
    }
    // The Expected Checkin a Checkout written now sends: Temp checkout's due time, worked out at each Checkout (so a
    // confirm left open past 2:50 pm rolls over), or Bulk checkout's Options date. Throws, writing nothing, when there's none.
    const dueNow = () => {
      if (!times) return expectedCheckin
      const due = dueFor(round)
      if (!due) throw new Error(NO_SCHOOL_DAY)
      if (due <= stamp(now())) throw new Error('The due time has passed. Change it, then scan again')
      return due
    }
    // The Expected Checkin the last Checkout went out with, for Resume's check (left); null until one is sent.
    let sent: string | null = null
    // guard: what Checkout's own last read must still find. Temp checkout's tag records the due time it sent (#63 §2).
    const checkout = (due: string, guard: Pick<CheckoutOptions, 'fromStatusId' | 'fromLocationId'> = {}) => {
      sent = due
      return bridge.checkout(a.id, { targetType: 'user', targetId: user.id, ...guard, expectedCheckin: due || undefined, note: workflowNote(workflow, { text: note, due: times && due }) })
    }
    // As a Checkout (or Move) leaves it: to this User, the Status Label kept, and the Expected Checkin it sent (or none).
    // Found so on Resume, it went through: the User's count goes up as for any Checkout.
    const left = (done: (due: string) => Done) => (now: Asset) => (sent !== null && now.assignee?.type === 'user' && now.assignee.id === user.id && now.statusId === a.statusId && (now.expectedCheckin ?? '') === sent ? (held(user.id, 1, mine), done(sent)) : null)
    if (was) {
      // Someone else's: the choice step. Move checks it in from them (no Status Label change), then out to this User.
      const from = assigneeName(was)
      // Whether it's a Temp checkout, for the undo: a time of day alone doesn't make one (an ordinary Checkout can have
      // one too), so History says, as for Bulk return's undo. History that can't be read counts as an ordinary Checkout.
      // The Move finds it before its Checkin, so it's known by the time Resume can find the Move went through.
      let temp = false
      // due: the Expected Checkin the Move's Checkout sent.
      const done = (due: string): Done => {
        // Undo: a Checkin, then a Checkout back to the previous Assignee with the Status Label and Expected Checkin it
        // had. A Temp checkout is made one again.
        const run = async (now: Asset) => {
          stillTheirs(now, due)
          // A label changed (or made non-deployable) since couldn't be checked out again.
          if (now.statusId !== a.statusId || now.statusType !== 'deployable') throw new Error(`${a.assetTag} is '${now.status}' now`)
          // Both calls must be allowed before the first, so a refused Checkout never leaves it checked in.
          if (!now.can.checkin || !now.can.checkout) throw new Error(NOT_ALLOWED)
          const { expectedCheckin: had } = a
          const mine = session
          await bridge.checkin(a.id, { note: undoNote(workflow), fromAssignee: { type: 'user', id: user.id }, fromStatusId: a.statusId ?? undefined })
          sameSession(mine)
          await bridge.checkout(a.id, { targetType: was.type, targetId: was.id, statusId: a.statusId ?? undefined, fromStatusId: a.statusId ?? undefined, expectedCheckin: had ?? undefined, note: undoNote(workflow, temp ? had! : undefined) })
            .catch((e: Error) => { throw new Error(`Checked in from ${user.name}, but checkout back to ${from} failed: ${e.message}`) })
          held(user.id, -1, mine)
        }
        return { text: 'Checked out', what: times ? `${whatFor(user, due)}, moved from ${from}` : `Moved from ${from}`, undo: { says: `${a.assetTag} → ${user.name}, moved from ${from}`, run } }
      }
      const move = async (now: Asset): Promise<Done> => {
        // Checked before the Checkin, so a Checkout that can't happen leaves nothing half done.
        if (now.assignee?.type !== was.type || now.assignee.id !== was.id || now.statusId !== a.statusId || now.statusType !== 'deployable') throw new Error(`${a.assetTag} changed since it was scanned`)
        if (!now.can.checkin || !now.can.checkout) throw new Error(NOT_ALLOWED)
        dueNow()
        const mine = session
        if (a.expectedCheckin && a.expectedCheckin.length > 10) {
          const n = parseWorkflowNote((await bridge.getAsset(a.id).catch(() => null))?.history.find((h) => h.action === 'Checkout')?.note ?? null)
          sameSession(mine)
          temp = !!n && (n.undo ? !!n.due : n.workflow === 'Temp checkout')
        }
        // The Checkin's and Checkout's own last reads check the Assignee and Status Label again.
        await bridge.checkin(a.id, { note: workflowNote(workflow, { move: true }), fromAssignee: { type: was.type, id: was.id }, fromStatusId: a.statusId ?? undefined })
        sameSession(mine)
        // Left checked in, with no automatic return to the previous Assignee, so the Operator sees it and sorts it out.
        // The due time is worked out again for the Checkout itself: the Checkin may have taken it past 2:50 pm.
        // A Checkout that lost the connection or timed out may have gone through, so it pauses the queue and Resume checks
        // the Asset (left); any other failure is this row's, since sending the Move again would find it checked in.
        const due = await (async () => {
          const due = dueNow()
          await checkout(due, { fromStatusId: a.statusId ?? undefined })
          return due
        })().catch((e: Failure) => {
          throw { kind: e.kind === 'unreachable' || e.kind === 'timeout' ? e.kind : 'refused', message: `Checked in from ${from}, but checkout to ${user.name} failed: ${e.message}` } satisfies Failure
        })
        held(user.id, 1, mine)
        return done(due)
      }
      return { what, choice: { fix: 'Move to this User', blocked: a.can.checkin ? '' : NOT_ALLOWED, stop: stop!, write: move, left: left(done) } }
    }
    // Snipe-IT can't check in to no Location (it uses the Default Location instead), so that undo is by hand.
    const byHand = a.locationId === null && a.defaultLocation
    // due: the Expected Checkin the Checkout sent.
    const done = (due: string): Done => {
      // Undo: a Checkin putting back the Status Label and Location it had (Snipe-IT's Checkin would send it to its Default Location).
      const run = async (now: Asset) => {
        stillTheirs(now, due)
        // A label someone set since the Checkout isn't overwritten with the old one.
        if (now.statusId !== a.statusId) throw new Error(`${a.assetTag} is '${now.status}' now`)
        // A Checkin with no Location moves it to its Default Location, so "no Location" can't be put back while it has one.
        if (a.locationId === null && now.defaultLocation) throw new Error(`${a.assetTag} had no Location; a Checkin would move it to its Default Location, ${now.defaultLocation}`)
        // Checkin's own last read checks all three again.
        await bridge.checkin(a.id, { statusId: a.statusId ?? undefined, locationId: a.locationId ?? undefined, note: undoNote(workflow), fromAssignee: { type: 'user', id: user.id }, fromStatusId: a.statusId ?? undefined, noDefaultLocation: a.locationId === null })
        held(user.id, -1, mine)
      }
      return { text: 'Checked out', what: whatFor(user, due), undo: byHand ? `Snipe-IT would check ${a.assetTag} in to its Default Location, ${a.defaultLocation}, not back to no Location. Open ${a.assetTag} to put it back by hand.` : { says: `${a.assetTag} → ${user.name}`, run } }
    }
    const write = async (now: Asset): Promise<Done> => {
      if (now.assignee || now.statusId !== a.statusId || now.locationId !== a.locationId) throw new Error(`${a.assetTag} changed since it was scanned`)
      const due = dueNow()
      await checkout(due, { fromStatusId: a.statusId ?? undefined, fromLocationId: a.locationId })
      held(user.id, 1, mine)
      return done(due)
    }
    return { what, confirm: { write, left: left(done) } }
  }, events, now, pace)

  function choose(user: UserCard) {
    step = { step: 'scan', user, round: ++round }
    events.changed()
  }

  return {
    runner,
    workflow,
    get step() { return step },
    get options() { return options },
    /** Temp checkout: the due time a Checkout now gets ("YYYY-MM-DD HH:MM"), or null (none within a year, or Bulk checkout). */
    get due() { return dueFor(step.step === 'scan' ? step.round : undefined) },
    /** Temp checkout: changes this User's due time ("YYYY-MM-DD HH:MM") until Done or another User; returns why not ('' when set). */
    setDue(to: string): string {
      if (step.step !== 'scan') return 'Find the User first'
      const [date = '', time = ''] = to.split(' ')
      if (!realDate(date) || !realTime(time)) return 'Choose a due date and time'
      // 00:00 reads back as a date-only Expected Checkin, due at the end of that date (#71).
      if (time === '00:00') return "A due time can't be midnight (00:00)"
      if (to <= stamp(now())) return 'That due time has already passed'
      dueSets.set(step.round, to)
      events.changed()
      return ''
    },
    /** Sets the Options for every Checkout from now on; returns why not ('' when set). */
    setOptions(o: CheckoutSession): string {
      try {
        workflowNote(workflow, { text: o.note })
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
    scan(raw: string): string {
      if (step.step !== 'scan') return 'Find the User first'
      // Temp checkout: refused before any lookup when there's no due time to give it.
      if (times && !dueFor(step.round)) return NO_SCHOOL_DAY
      return runner.scan(raw, { ...options, user: step.user, round: step.round })
    },
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
      dueSets.clear()
      options = NO_OPTIONS
      runner.reset()
    },
  }
}
export type BulkCheckout = ReturnType<typeof createBulkCheckout>

export const DAMAGED = 'Damaged'
export const NO_DAMAGED = `No Status Label named '${DAMAGED}' in Snipe-IT; ask an admin to create one`
const isRepair = (t: StatusLabel | null, typeId: number) => !!t && (t.id === typeId || t.name.trim().toLowerCase() === 'repair')
/** What Repair intake needs from Snipe-IT before a scan: the Damaged label, and the Maintenance type with the Settings
 *  id it was looked up with. */
type RepairSetup = { damaged: number; typeId: number | null; fallback: number | null }

// Repair intake (#59): each scanned Asset is confirmed with what happened to it (required), then checked in as Damaged
// (or just marked Damaged if it isn't checked out), a repair Maintenance is opened, and a User who held it gets a User
// notes line. Each step after the first runs only once the first worked, and none undoes an earlier one. Only the
// first step can pause the Workflow (#73); a later one that fails is its sub-result.
export function createRepairIntake(bridge: Pick<SnipeItBridge, 'assetByTag' | 'keyRefused' | 'getAsset' | 'checkin' | 'checkout' | 'updateStatus' | 'addAssetNote' | 'statusLabels' | 'operatorName' | 'repairTypeId' | 'openMaintenances' | 'createMaintenance' | 'deleteMaintenance' | 'appendUserNotes' | 'removeUserNotesLine'>, events: Events, now = () => new Date(), pace = PACE_MS) {
  // Looked up when the Workflow opens and kept for the session; what isn't found yet (Damaged, a Repair type) is looked
  // for again at the next open.
  let setup: Promise<RepairSetup> | null = null
  let found: Partial<RepairSetup> = {}
  let blocked = ''
  // Bumped by reset, so a lookup for the old server never lands.
  let attempt = 0
  // Bumped by reset too: an intake still writing stops before its next step, which would go to the new server.
  let session = 0
  // "(by <Operator>)", read when the Workflow opens; failing, it's read again when a User notes line needs it.
  let operator: Promise<string> | null = null
  const operatorName = () => (operator ??= bridge.operatorName().catch((e) => { operator = null; throw e }))

  // The Maintenance step's sub-result; for Undo last, the id of the Maintenance it opened, or that one was open already.
  async function maintenance(a: Asset, typeId: number | null, notes: string, still: () => void): Promise<{ text: string; made?: number; reused?: true }> {
    if (typeId === null) return { text: 'not opened: no Repair type found' }
    try {
      if ((await bridge.openMaintenances(a.id)).some((m) => isRepair(m.type, typeId))) return { text: 'already open', reused: true }
      still()
      return { text: 'opened', made: await bridge.createMaintenance({ assetId: a.id, typeId, name: `${a.assetTag} damaged`, startDate: localDate(now()), notes }) }
    } catch (e) {
      return { text: `not opened: ${(e as Error).message}` }
    }
  }

  const runner = createRunner<null>(bridge, async (a) => {
    const { damaged, typeId } = await (setup ?? Promise.reject(new Error(NO_DAMAGED)))
    const held = a.assignee
    // Checked out, it's a Checkin; otherwise the Asset is edited (its Status Label and a note).
    if (held ? !a.can.checkin : !a.can.update) throw new Error(NOT_ALLOWED)
    // No confirm, so a second intake can't stack another note or Maintenance.
    if (!held && a.statusId === damaged) throw new Error('Already Damaged: nothing to do')
    const from = held && assigneeName(held)
    const user = held?.type === 'user' ? held : null
    // As scanned, for Undo last to put back.
    const { statusId, statusType, status, expectedCheckin } = a
    const write = async (current: Asset, text: string): Promise<Done> => {
      if (current.assignee?.type !== held?.type || current.assignee?.id !== held?.id || current.statusId !== statusId) throw new Error(`${a.assetTag} changed since it was scanned`)
      // Checked before any write: a note Snipe-IT can't keep (a link) refuses the intake with nothing changed.
      const note = workflowNote('Repair intake', { text })
      const mine = session
      // No Location is sent, so a checked-in Asset goes back to its Default Location, as any Checkin from the app does.
      // Checkin's own last read checks the Assignee and Status Label again, so a Checkout changed since isn't checked in.
      if (held) await bridge.checkin(a.id, { statusId: damaged, note, fromAssignee: { type: held.type, id: held.id }, fromStatusId: a.statusId ?? undefined })
      else await bridge.updateStatus(a.id, damaged)
      return rest(text, mine)
    }
    // The steps after the first, which never pause: each failure is its sub-result.
    const rest = async (text: string, mine: number): Promise<Done> => {
      const note = workflowNote('Repair intake', { text })
      const still = () => { if (mine !== session) throw new Error('Stopped: Settings changed') }
      const sub: string[] = []
      still()
      if (!held) await bridge.addAssetNote(a.id, note).catch((e: Error) => sub.push(`Asset note not added: ${e.message}`))
      still()
      const { text: opened, made, reused } = await maintenance(a, typeId, note, still)
      sub.push(`Maintenance ${opened}`)
      still()
      let copy: string | undefined
      let added: string | undefined
      if (!user) sub.push('User note: no User')
      else {
        try {
          const line = userNotesLine(localDate(now()), a.assetTag, text, await operatorName())
          // Offered whatever goes wrong from here; without the Operator's name there's no line to offer.
          copy = line
          still()
          await bridge.appendUserNotes(user.id, line)
          sub.push('User note added')
          added = line
          copy = undefined
        } catch (e) {
          sub.push(`User note skipped: ${(e as Error).message}`)
        }
      }
      // Undo last (#59 §6), in order: the Asset back as it was (if that fails, nothing else is tried), then the
      // Maintenance this intake opened, then the User notes line while the notes still end with it.
      const run = async (current: Asset): Promise<string[]> => {
        if (current.assignee) throw new Error(`${a.assetTag} is checked out to ${assigneeName(current.assignee)} now`)
        if (current.statusId !== damaged) throw new Error(`${a.assetTag} is '${current.status}' now`)
        const mine = session
        const still = () => { if (mine !== session) throw new Error('Stopped: Settings changed') }
        const results: string[] = []
        // A Temp checkout is made one again (its tag back), but a time of day alone doesn't make one: an ordinary Checkout
        // can have one too. So History says, as for Bulk return's undo: its newest Checkout is the one the intake checked
        // in. History that can't be read puts back an ordinary Checkout. Snipe-IT may send the checkout email again.
        let due: string | undefined
        if (held && expectedCheckin && expectedCheckin.length > 10) {
          const n = parseWorkflowNote((await bridge.getAsset(a.id).catch(() => null))?.history.find((h) => h.action === 'Checkout')?.note ?? null)
          still()
          if (n && (n.undo ? n.due : n.workflow === 'Temp checkout')) due = expectedCheckin
        }
        // Checkout's own last read refuses a label someone set since the intake, so nothing is written over it.
        if (held) await bridge.checkout(a.id, { targetType: held.type, targetId: held.id, statusId: statusId ?? undefined, fromStatusId: damaged, expectedCheckin: expectedCheckin ?? undefined, note: undoNote('Repair intake', due) })
        else {
          await bridge.updateStatus(a.id, statusId!)
          still()
          await bridge.addAssetNote(a.id, undoNote('Repair intake')).catch((e: Error) => results.push(`Asset note not added: ${e.message}`))
        }
        still()
        if (made !== undefined) await bridge.deleteMaintenance(made).then(() => results.push('Maintenance deleted'), (e: Error) => results.push(`Maintenance not deleted: ${e.message}`))
        else if (reused) results.push('Maintenance left open: it was open before')
        still()
        if (added) await bridge.removeUserNotesLine(user!.id, added).then(() => results.push('User note removed'), (e: Error) => results.push(`User note not removed: ${e.message}`))
        return results
      }
      // Snipe-IT checks out only to a deployable Status Label, so an Asset that was out under another (Pending, or
      // already Damaged) can't be put back from the list.
      const undo = held && statusType !== 'deployable'
        ? `Snipe-IT can't check out an Asset with status '${status}'. Open ${a.assetTag} to put it back by hand.`
        : { says: held ? `${a.assetTag} checked in as Damaged from ${from}` : `${a.assetTag} marked Damaged`, run }
      return { text: cleanText(text), what: held ? `Damaged, from ${from}` : "Damaged (wasn't checked out)", undo, sub, copy }
    }
    const says = [
      held ? `Check in from ${from}, mark Damaged` : 'Mark Damaged, add the note to its History',
      typeId === null ? 'no Maintenance (no Repair type found)' : 'open a repair Maintenance',
      user && `add a line to ${user.name}'s notes`,
    ].filter(Boolean).join(', ')
    // A first step that lost the connection may have gone through: checked in (or marked) Damaged, the rest is sent then.
    const left = (now: Asset, text: string) => (!now.assignee && now.statusId === damaged ? rest(text, session) : null)
    return { what: held ? `From ${from}` : "Wasn't checked out", confirm: { needs: 'Say what happened', says, write, left } }
  }, events, now, pace)

  return {
    runner,
    /** Why no scan is taken (no Damaged label, or Snipe-IT couldn't be read), or ''. */
    get blocked() { return blocked },
    /** Opening the Workflow: looks up what it doesn't have yet. fallback: Settings' Maintenance type for repairs. */
    async open(fallback: number | null): Promise<void> {
      operatorName().catch(() => {})
      // A type found is kept until the Settings id changes, which may be what the Operator just corrected.
      const typeKept = found.typeId != null && found.fallback === fallback
      if (found.damaged !== undefined && typeKept) return
      const mine = ++attempt
      const was = found
      const next = (async (): Promise<RepairSetup> => {
        const damaged = was.damaged ?? (await bridge.statusLabels()).find((l) => l.name.trim().toLowerCase() === DAMAGED.toLowerCase())?.id
        if (damaged === undefined) throw new Error(NO_DAMAGED)
        return { damaged, typeId: typeKept ? was.typeId! : await bridge.repairTypeId(fallback), fallback }
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
    scan: (raw: string) => blocked || runner.scan(raw, null),
    /** Settings were saved: a new API token on the same server may be another Operator, so "(by …)" is read again. */
    forgetOperator() {
      operator = null
    },
    reset() {
      attempt++
      session++
      setup = null
      found = {}
      blocked = ''
      operator = null
      runner.reset()
    },
  }
}
export type RepairIntake = ReturnType<typeof createRepairIntake>
