import { useEffect, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArchiveRestore, PackageCheck, PackageOpen, Timer, Wrench, type LucideIcon } from 'lucide-react'
import { cleanText, WORKFLOWS, workflowNote, type Workflow } from '../../main/notes'
import { dueLabel } from '../../main/calendar'
import { localDate } from '../../main/export'
import type { StatusLabel } from '../../main/snipeit'
import { OutcomeText } from './ListView'
import { assigneeName, cleanTag, fieldKey, handoutKind, NOT_SURE, pauseSays, type BulkCheckout, type BulkReturn, type Handout, type IncomingRepair, type RepairIntake, type Row, type Runner } from './workflows'

// The Workflows built so far; the rest join as they're built. Ctrl+N follows glossary order from the start (WORKFLOWS).
export const BUILT: Workflow[] = ['Bulk checkout', 'Bulk return', 'Repair intake', 'Incoming repair', 'Temp checkout']
export const workflowIcon: Partial<Record<Workflow, LucideIcon>> = { 'Bulk checkout': PackageCheck, 'Bulk return': ArchiveRestore, 'Repair intake': Wrench, 'Incoming repair': PackageOpen, 'Temp checkout': Timer }
const about: Partial<Record<Workflow, string>> = {
  'Bulk checkout': 'Find a User, then scan Assets and confirm each to check it out to them.',
  'Bulk return': 'Pick where returns go, then scan Assets to check them in.',
  'Repair intake': 'Scan a broken Asset, say what happened, then check it in as Damaged and open a repair Maintenance.',
  'Incoming repair': 'Scan an Asset back from repair, then make it Ready to Deploy and close its repair Maintenance.',
  'Temp checkout': 'Lend Assets to a User for the rest of the school day, due back at the end-of-day time.',
}
export const shortcut = (w: Workflow) => `Ctrl ${WORKFLOWS.indexOf(w) + 1}`

// A short buzz for a refused or failed scan; success is silent, as the scanner already beeps.
let audio: AudioContext | undefined
export function errorSound() {
  try {
    audio ??= new AudioContext()
    const tone = audio.createOscillator()
    const gain = audio.createGain()
    tone.type = 'square'
    tone.frequency.value = 220
    gain.gain.value = 0.08
    tone.connect(gain).connect(audio.destination)
    tone.start()
    tone.stop(audio.currentTime + 0.15)
  } catch {}
}

// One card per built Workflow, like All records.
export function WorkflowsPage({ doneCount, onOpen }: { doneCount: (w: Workflow) => number; onOpen: (w: Workflow) => void }) {
  return (
    <>
      <header className="head"><h1>Workflows</h1></header>
      <div className="workflow-cards">
        {BUILT.map((w) => {
          const Icon = workflowIcon[w]!
          return (
            <button key={w} className="workflow-card" onClick={() => onOpen(w)}>
              <span className="card-title"><Icon size={18} />{w}<kbd>{shortcut(w)}</kbd></span>
              <span className="dim">{about[w]}</span>
              {doneCount(w) > 0 && <span className="dim">{doneCount(w)} done this session</span>}
            </button>
          )
        })}
      </div>
    </>
  )
}

// Only the keys that do something in the current step (#75 §5), with a one-line hint.
function KeysPanel({ keys, hint }: { keys: [key: string, does: string][]; hint: string }) {
  const others = BUILT.length > 1 ? [['Ctrl 1–5', 'Other Workflows'] as [string, string]] : []
  return (
    <aside className="keys" aria-label="Keys">
      <h2>Keys</h2>
      <dl>{[...keys, ['Ctrl K', 'Lookup'], ...others].map(([k, does]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{does}</dd></div>)}</dl>
      <p className="dim">{hint}</p>
    </aside>
  )
}

export const UNDO_KEY = 'Ctrl Z'
const UNDO_TIP = `${UNDO_KEY}: puts the newest done row back. Snipe-IT's History keeps both entries, emails it already sent stay sent, and the undo may send another.`

// One Workflow's Running list, newest first, with Undo last (when the Workflow has it) and Clear. what: the Workflow's
// "what" cell for a row. undoBlocked, clearBlocked: why each button is off ('' when it isn't).
export function RunningList<C>({ rows, paused, doneLabel, what, undoBlocked, clearBlocked, onUndo, onOpenAsset, onClear }: {
  rows: Row<C>[]
  paused: boolean
  doneLabel: string
  what: (r: Row<C>) => ReactNode
  undoBlocked: string
  clearBlocked: string
  onUndo?: () => void
  onOpenAsset: (id: number) => void
  onClear: () => void
}) {
  const done = rows.filter((r) => r.result.state === 'done').length
  // The row whose line was just copied, and whether it was, so its button says so.
  const [copied, setCopied] = useState<{ key: number; ok: boolean } | null>(null)
  return (
    <>
      <div className="section running-head">
        <span>{done} {doneLabel}</span>
        <div className="actions">
          {onUndo && <button className="quiet" disabled={!!undoBlocked} title={undoBlocked ? `${undoBlocked}. ${UNDO_TIP}` : UNDO_TIP} onClick={onUndo}>Undo last</button>}
          <button className="quiet" disabled={!!clearBlocked || rows.length === 0} title={clearBlocked || undefined} onClick={onClear}>Clear</button>
        </div>
      </div>
      <table className="history running">
        <thead><tr><th>Time</th><th>Asset Tag</th><th>Name</th><th>What</th><th>Result</th></tr></thead>
        <tbody>
          {rows.map((r) => r.line ? (
            <tr key={r.key} className="line"><td className="dim">{r.time}</td><td colSpan={4}>{what(r)}</td></tr>
          ) : (
            <tr key={r.key} className={r.result.state === 'failed' ? 'failed' : undefined}>
              <td className="dim">{r.time}</td>
              <td>{r.assetId === null ? <span className="mono">{r.tag}</span> : <button className="link mono" onClick={() => onOpenAsset(r.assetId!)}>{r.tag}</button>}</td>
              <td>{r.name || '—'}</td>
              <td>{what(r)}</td>
              <td>
                {r.result.state === 'waiting' ? <span className="dim">{paused ? 'Waiting (paused)' : 'Waiting…'}</span>
                  : r.result.state === 'unsure' ? <span className="late">{NOT_SURE}: {r.result.reason}</span>
                  : r.result.state === 'confirm' ? <span className="dim">Waiting for confirm</span>
                  : r.result.state === 'choice' ? <span className="dim">Waiting for a choice</span>
                  : r.result.state === 'undone' ? <span className="dim">Undone{r.undoFailed && <>, but <span className="late">{r.undoFailed}</span></>}</span>
                  : r.result.state === 'neutral' ? <span className="dim">{r.result.text}</span>
                  : <OutcomeText outcome={r.result} />}
                {(r.result.state === 'done' || r.result.state === 'undone') && r.sub?.map((s) => <span key={s} className="sub-result">{s}</span>)}
                {r.result.state === 'done' && r.copy && (
                  <button className="link" title={r.copy} onClick={() => navigator.clipboard.writeText(r.copy!).then(() => setCopied({ key: r.key, ok: true }), () => setCopied({ key: r.key, ok: false }))}>{copied?.key !== r.key ? 'Copy line' : copied.ok ? 'Copied' : "Couldn't copy"}</button>
                )}
                {r.undoFailed && r.result.state !== 'undone' && <> <span className="late">Undo failed: {r.undoFailed}</span></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="empty">Nothing scanned yet</p>}
    </>
  )
}

// Under the field while the queue is Paused (#73): why, what's waiting, and how to carry on. The buttons don't take focus,
// so scanning carries on into the field. A slow-down counts down and carries on by itself.
function PauseBar({ runner, onSettings }: { runner: Pick<Runner, 'paused' | 'pending' | 'resume' | 'dropWaiting'>; onSettings: () => void }) {
  const p = runner.paused
  const [, tick] = useState(0)
  useEffect(() => {
    if (p?.kind !== 'rateLimited') return
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [p])
  if (!p) return null
  const button = (label: string, onClick: () => void, quiet = true) =>
    <button key={label} type="button" className={quiet ? 'quiet' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{label}</button>
  const resume = button('Resume', () => runner.resume(), false)
  const drop = button('Drop waiting', () => runner.dropWaiting())
  const settings = button('Settings', onSettings)
  return (
    <div className="pause-bar" role="group" aria-label="Paused">
      <span>{pauseSays(p, runner.pending)}</span>
      <div className="actions">{p.kind === 'rateLimited' ? [drop] : p.kind === 'key' ? [settings, resume, drop] : [resume, drop, settings]}</div>
    </div>
  )
}

// Bulk return (#58). The field is never disabled and takes focus on every step change and when the window comes back,
// so the scanner's next keystrokes always land in it.
export function BulkReturnView({ flow, locations, field, onOpenAsset, onDone, onSettings }: {
  flow: BulkReturn
  locations: StatusLabel[]
  field: RefObject<HTMLInputElement | null>
  onOpenAsset: (id: number) => void
  onDone: () => void
  onSettings: () => void
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const step = flow.step
  const q = text.trim().toLowerCase()
  const shown = q ? locations.filter((l) => l.name.toLowerCase().includes(q)) : locations
  // The first match is highlighted as the Operator types; with nothing typed, the last Location (none the first time).
  // Worked out while rendering, not in an effect, so an Enter typed straight after the text sees the right one.
  const [moved, setMoved] = useState<{ q: string; i: number } | null>(null)
  const hi = moved?.q === q ? Math.min(moved.i, shown.length - 1) : q ? 0 : shown.findIndex((l) => l.id === flow.last?.id)
  // Leaving the step (Change Location, Done, another page) closes an open Undo confirm without writing.
  useEffect(() => {
    setText(''); setMoved(null); field.current?.focus()
    return () => flow.runner.cancelUndo()
  }, [step])
  useEffect(() => {
    const back = () => document.activeElement === document.body && field.current?.focus()
    window.addEventListener('focus', back)
    return () => window.removeEventListener('focus', back)
  }, [])

  async function pick(location: StatusLabel) {
    setStatus('')
    setStatus(await flow.start(location).catch((e: Error) => e.message))
  }
  // Undo last: Ctrl+Z on the empty field (with text in it, it's the usual text undo) or the button opens its confirm.
  function askUndo() {
    setStatus(flow.runner.askUndo())
    field.current?.focus()
  }
  function undo() {
    flow.runner.undo()
    field.current?.focus()
  }
  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Enter on the empty field confirms an open Undo; a scan closes it.
    if (step.step === 'scan' && !cleanTag(text) && flow.runner.confirm) return undo()
    if (step.step === 'scan') return setStatus(flow.scan(text)), setText('')
    if (shown[hi]) return pick(shown[hi])
    setStatus(q ? 'Pick the Location first.' : 'Pick the Location returns go to.')
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (step.step === 'scan' && e.key === 'Escape' && flow.runner.confirm) return flow.runner.cancelUndo()
    if (step.step === 'scan' && e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !text) return e.preventDefault(), askUndo()
    if (step.step !== 'location' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !shown.length) return
    e.preventDefault()
    setMoved({ q, i: e.key === 'ArrowDown' ? Math.min(hi + 1, shown.length - 1) : Math.max(hi - 1, 0) })
  }

  const scanning = step.step === 'scan'
  const here = scanning ? step.location : null
  const confirm = scanning ? flow.runner.confirm : null
  return (
    <div className="workflow">
      <div className="workflow-main">
        <header className="head">
          <h1>{here ? `Returning to ${here.name}` : 'Bulk return'}<span className="sub">{here ? 'Bulk return' : 'Where are returns going?'}</span></h1>
          <div className="actions">
            {here && <button className="quiet" onClick={() => flow.done()}>Change Location</button>}
            <button className="quiet" onClick={onDone}>Done</button>
          </div>
        </header>
        <form className="workflow-field" onSubmit={onSubmit}>
          <input
            ref={field}
            autoFocus
            className="search"
            value={text}
            onChange={(e) => { setText(e.target.value); setStatus('') }}
            onKeyDown={onKeyDown}
            placeholder={here ? `Scan an Asset Tag to return to ${here.name}` : 'Where are returns going? (e.g. IT office)'}
            aria-label={here ? 'Asset Tag' : 'Location returns go to'}
            {...(!here && { role: 'combobox', 'aria-expanded': true, 'aria-controls': 'return-locations', 'aria-activedescendant': shown[hi] ? `return-location-${shown[hi].id}` : undefined })}
          />
          <p className="message" role="status">{status}</p>
          <PauseBar runner={flow.runner} onSettings={onSettings} />
          {confirm && (
            // In place under the field, which keeps focus so no scan is lost; the buttons don't take it either.
            <div className="actions undo-confirm" role="group" aria-label="Undo last">
              <span>{confirm}</span>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={undo}>Undo</button>
              <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={() => flow.runner.cancelUndo()}>Cancel</button>
            </div>
          )}
        </form>
        {here ? (
          <RunningList rows={flow.runner.rows} paused={!!flow.runner.paused} doneLabel="checked in" undoBlocked={flow.runner.undoBlocked} clearBlocked={flow.runner.clearBlocked} onUndo={askUndo} onOpenAsset={onOpenAsset} onClear={() => flow.runner.clear()}
            what={(r) => (
              <>
                {/* A row's Location shows only when it differs from the current one (after Change Location). */}
                {r.ctx.id === here.id ? r.what : [r.what, `to ${r.ctx.name}`].filter(Boolean).join(', ')}
                {/* Came back after its Expected Checkin, from the lookup answer; a refused Asset didn't come back. */}
                {r.before?.overdue != null && (r.result.state === 'done' || r.result.state === 'undone') && <> <span className="chip c-red">Overdue</span></>}
              </>
            )} />
        ) : (
          <>
            <ul className="pick-list" id="return-locations" role="listbox" aria-label="Locations">
              {shown.map((l, i) => (
                // Clicking keeps focus in the field, so a scan right after still lands there.
                <li key={l.id} id={`return-location-${l.id}`} role="option" aria-selected={i === hi} className={i === hi ? 'sel' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(l)}>{l.name}</li>
              ))}
            </ul>
            {q && shown.length === 0 && <p className="empty">No Location matches '{text.trim()}'</p>}
          </>
        )}
        <p className="sr-only" aria-live="polite">{confirm ?? flow.runner.announce}</p>
      </div>
      {confirm
        ? <KeysPanel keys={[['Enter', 'Undo'], ['Esc', 'Cancel']]} hint="Scanning another Asset Tag cancels the undo." />
        : here
        ? <KeysPanel keys={[['Enter', 'Check in'], [UNDO_KEY, 'Undo last']]} hint="Each scanned Asset is checked in at once, set to Ready to Deploy. Undo last puts the newest one back." />
        : <KeysPanel keys={[['Enter', 'Pick Location'], ['↑ ↓', 'Move the highlight']]} hint="Type to filter the Locations." />}
    </div>
  )
}

// Bulk checkout (#57), and Temp checkout (#61 §7) on the same steps with a due time in the header. Step 1 finds the User (exact match on Enter, else Snipe-IT's picker list as the Operator types);
// step 2 scans Assets for them, each confirmed in place under the field, which keeps focus so no scan is lost. Someone
// else's Asset opens a choice there instead: Move to this User (a click, or Tab then Enter) or Stop (Esc).
export function BulkCheckoutView({ flow, field, onOpenAsset, onSettings }: {
  flow: BulkCheckout
  field: RefObject<HTMLInputElement | null>
  onOpenAsset: (id: number) => void
  onSettings: () => void
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  // The picker list and the text it's for; an answer for older text is never shown against newer text.
  const [list, setList] = useState<{ q: string; users: StatusLabel[] } | null>(null)
  const [moved, setMoved] = useState<{ q: string; i: number } | null>(null)
  // Temp checkout: the due time's date and time while the Operator changes it, or null.
  const [editing, setEditing] = useState<{ date: string; time: string } | null>(null)
  // Handouts (#188): what's typed into Also hand out, the matches it's for, and the quantity the next pick gets.
  const [stockText, setStockText] = useState('')
  const [stock, setStock] = useState<{ q: string; rows: Omit<Handout, 'qty'>[] } | null>(null)
  const [qty, setQty] = useState('1')
  const temp = flow.workflow === 'Temp checkout'
  // Temp checkout's header reads the clock, so it re-renders now and then to roll past the end-of-day time.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!temp) return
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [temp])
  const step = flow.step
  const user = step.step === 'scan' ? step.user : null
  const q = text.trim()
  // What the field holds now, for an answer that lands after the Operator typed on.
  const typed = useRef(q)
  typed.current = q
  const shown = !user && list?.q === q ? list.users : []
  const hi = moved?.q === q ? Math.min(moved.i, shown.length - 1) : 0
  // A new step or round starts the field empty; the User's Asset count changing mid-round keeps what's being typed.
  useEffect(() => {
    setText(''); setList(null); setMoved(null); setEditing(null); setStockText(''); setStock(null); field.current?.focus()
  }, [fieldKey(step)])
  // Stock matches as the Operator types into Also hand out, after a short pause.
  const sq = stockText.trim()
  useEffect(() => {
    if (!user || !sq) return setStock(null)
    let stale = false
    const timer = setTimeout(() => flow.suggestStock(sq).then((rows) => !stale && setStock({ q: sq, rows }), (e: Error) => !stale && setStatus(e.message)), 250)
    return () => { stale = true; clearTimeout(timer) }
  }, [sq, user])
  // Leaving closes an open confirm or Undo confirm without writing; the queue keeps running.
  useEffect(() => {
    flow.runner.enter()
    const back = () => document.activeElement === document.body && field.current?.focus()
    window.addEventListener('focus', back)
    return () => (window.removeEventListener('focus', back), flow.runner.leave())
  }, [])
  // Snipe-IT's picker list as the Operator types, after a short pause, like the Checkout form's.
  useEffect(() => {
    if (user || !q) return setList(null)
    let stale = false
    const timer = setTimeout(() => flow.suggest(q).then((users) => !stale && setList({ q, users }), (e: Error) => !stale && setStatus(e.message)), 250)
    return () => { stale = true; clearTimeout(timer) }
  }, [q, user])

  async function find() {
    try {
      const r: { users?: StatusLabel[]; status: string } = moved?.q === q && shown[hi] ? await flow.pick(shown[hi].id) : await flow.find(q, shown, hi)
      if (typed.current !== q) return
      if (r.users) setList({ q, users: r.users })
      setStatus(r.status)
    } catch (e) {
      if (typed.current === q) setStatus((e as Error).message)
    }
  }
  function pick(id: number) {
    flow.pick(id).catch((e: Error) => setStatus(e.message))
  }
  function askUndo() {
    setStatus(flow.runner.askUndo())
    field.current?.focus()
  }
  function undo() {
    flow.runner.undo()
    field.current?.focus()
  }
  function confirm() {
    setStatus(flow.runner.confirmOpen())
    field.current?.focus()
  }
  function cancel() {
    flow.runner.cancelOpen()
    field.current?.focus()
  }
  function fix() {
    setStatus(flow.runner.fixOpen())
    field.current?.focus()
  }
  function handOut(h: Handout) {
    flow.handOut(h).then(setStatus)
    field.current?.focus()
  }
  // A pick is handed out now and kept as a button for the next Users.
  function pickStock(r: Omit<Handout, 'qty'>) {
    const h = { ...r, qty: Number(qty) || 1 }
    flow.addQuick(h)
    setStockText('')
    setStock(null)
    handOut(h)
  }
  function setDue(e: React.FormEvent) {
    e.preventDefault()
    const why = flow.setDue(`${editing!.date} ${editing!.time}`)
    setStatus(why)
    if (!why) (setEditing(null), field.current?.focus())
  }
  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('')
    // Enter on the empty field confirms an open confirm (or Undo); a scan confirms its own tag, or skips the waiting one.
    if (!cleanTag(text) && (flow.runner.open || flow.runner.confirm)) return flow.runner.open ? confirm() : undo()
    if (!user) return void find()
    if (!cleanTag(text)) return
    setStatus(flow.scan(text))
    setText('')
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && (user || flow.runner.confirm)) {
      e.preventDefault()
      // One level back: the open confirm, then the Undo confirm, then Done for this User.
      return flow.runner.open ? cancel() : flow.runner.confirm ? flow.runner.cancelUndo() : (flow.done(), setStatus(''))
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !text) return e.preventDefault(), askUndo()
    if (user || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !shown.length) return
    e.preventDefault()
    setMoved({ q, i: e.key === 'ArrowDown' ? Math.min(hi + 1, shown.length - 1) : Math.max(hi - 1, 0) })
  }

  const open = user ? flow.runner.open : null
  const undoConfirm = flow.runner.confirm
  const o = flow.options
  const who = (u: { username?: string; employeeNum?: string }) => [u.username, u.employeeNum && `#${u.employeeNum}`].filter(Boolean).join(', ')
  const a = open?.row.before
  const ctx = open?.row.ctx
  const choice = open?.choice
  // Who has it: a User with their username and employee number, or the Location or Asset.
  const has = a?.assignee && <>{a.assetTag} is checked out to <strong>{assigneeName(a.assignee)}</strong>{who(a.assignee) && ` (${who(a.assignee)})`}</>
  const due = flow.due
  const dueText = (d: string | null) => (d ? `Due ${dueLabel(d, new Date())}` : 'No School day in the next year')
  const said = open && (choice
    ? `${open.row.tag} is checked out to ${a?.assignee ? assigneeName(a.assignee) : 'someone else'}. ${choice.fix}: click it, or Tab then Enter. Esc to Stop.`
    : `Confirm ${open.row.tag}: Checkout to ${open.row.ctx.user.name}${temp ? `, ${dueText(due).toLowerCase()}` : ''}? Enter or rescan to confirm, Esc to cancel.`)
  return (
    <div className="workflow">
      <div className="workflow-main">
        <header className="head">
          {user ? (
            <h1>{user.name}<span className="sub">{[who(user), `holds ${user.assets} Asset${user.assets === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span></h1>
          ) : (
            <h1>{flow.workflow}<span className="sub">{['Who are the Assets for?', temp && `${dueText(due)}.`].filter(Boolean).join(' ')}</span></h1>
          )}
          {user && (
            <div className="actions">
              {/* Temp checkout: the due time every Checkout for this User gets; a change holds until Done or another User. */}
              {temp && (editing ? (
                <form className="actions" aria-label="Change due time" onSubmit={setDue} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setEditing(null), field.current?.focus())}>
                  <input type="date" required autoFocus aria-label="Due date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
                  <input type="time" required aria-label="Due time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} />
                  <button type="submit">Set</button>
                  <button type="button" className="quiet" onClick={() => (setEditing(null), field.current?.focus())}>Cancel</button>
                </form>
              ) : (
                <>
                  <strong>{dueText(due)}</strong>
                  <button className="quiet" onClick={() => setEditing({ date: due?.slice(0, 10) ?? '', time: due?.slice(11) ?? '' })}>Change</button>
                </>
              ))}
              <button className="quiet" onClick={() => (flow.done(), setStatus(''))}>Done</button>
            </div>
          )}
        </header>
        <form className="workflow-field" onSubmit={onSubmit}>
          <input
            ref={field}
            autoFocus
            className="search"
            value={text}
            onChange={(e) => { setText(e.target.value); setStatus(''); if (!user) flow.stopFinding() }}
            onKeyDown={onKeyDown}
            placeholder={user ? `Scan an Asset Tag for ${user.name}` : 'Find a User by name, email or employee number'}
            aria-label={user ? 'Asset Tag' : 'Find a User'}
            {...(!user && { role: 'combobox', 'aria-expanded': shown.length > 0, 'aria-controls': 'checkout-users', 'aria-activedescendant': shown[hi] ? `checkout-user-${shown[hi].id}` : undefined })}
          />
          <p className="message" role="status">{status}</p>
          <PauseBar runner={flow.runner} onSettings={onSettings} />
          {open && a && (
            // The buttons don't take focus when clicked either, so the next scan still lands in the field. A choice's
            // fix-it button is reached with Tab (Enter on the field never picks it); Esc there stops it too.
            <div className="scan-confirm" role="group" aria-label={choice ? 'Checked out to someone else' : 'Confirm checkout'} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), cancel())}>
              {choice && <p>{has}</p>}
              <div className="confirm-tag mono">{a.assetTag}</div>
              <dl className="confirm-facts">
                {([['Name', a.name], ['Asset Model', a.model], ['Serial', a.serial], ['Status Label', a.status]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}
              </dl>
              <p>→ {choice ? 'Move' : 'Checkout'} to <strong>{ctx!.user.name}</strong>{who(ctx!.user) && ` (${who(ctx!.user)})`}</p>
              {/* Temp checkout's due time is worked out again as it's written, so this is the one it gets if confirmed now. */}
              {(temp || ctx!.expectedCheckin || ctx!.note) && (
                <p className="dim">{[temp ? dueText(due) : ctx!.expectedCheckin && `Expected Checkin ${ctx!.expectedCheckin}`, ctx!.note && `Note: ${workflowNote(flow.workflow, { text: ctx!.note })}`].filter(Boolean).join(' · ')}</p>
              )}
              {choice ? (
                <div className="actions">
                  <button type="button" disabled={!!choice.blocked} title={choice.blocked || undefined} onMouseDown={(e) => e.preventDefault()} onClick={fix}>{choice.fix}</button>
                  <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Stop</button>
                  {choice.blocked && <span className="dim">{choice.blocked}</span>}
                </div>
              ) : (
                <div className="actions">
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={confirm}>Confirm</button>
                  <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Cancel</button>
                </div>
              )}
            </div>
          )}
          {undoConfirm && (
            <div className="actions undo-confirm" role="group" aria-label="Undo last">
              <span>{undoConfirm}</span>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={undo}>Undo</button>
              <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={() => flow.runner.cancelUndo()}>Cancel</button>
            </div>
          )}
        </form>
        {user && !temp && (
          // Beside the scans: stock has no tag, so it's found by name and sent at once. Buttons keep focus in the scan field.
          <section className="handouts" aria-label="Hand out">
            <div className="actions">
              {flow.quick.map((h) => (
                <span key={`${h.kind}-${h.id}`} className="quick">
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handOut(h)} title={`${handoutKind[h.kind]}: hand out to ${user.name}`}>{h.name} ×{h.qty}</button>
                  <button type="button" className="link" aria-label={`Forget ${h.name}`} title="Forget" onMouseDown={(e) => e.preventDefault()} onClick={() => flow.removeQuick(h)}>×</button>
                </span>
              ))}
              <input value={stockText} onChange={(e) => (setStockText(e.target.value), setStatus(''))} onKeyDown={(e) => e.key === 'Enter' && stock?.q === sq && stock.rows[0] && (e.preventDefault(), pickStock(stock.rows[0]))}
                placeholder="Also hand out an Accessory, Consumable or License…" aria-label="Also hand out" role="combobox" aria-expanded={!!sq && stock?.q === sq} aria-controls="handout-stock" />
              <label className="dim">Quantity <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Handout quantity" /></label>
            </div>
            {sq && stock?.q === sq && (
              <ul className="pick-list" id="handout-stock" role="listbox" aria-label="Stock matches">
                {stock.rows.map((r) => <li key={`${r.kind}-${r.id}`} role="option" aria-selected={false} onClick={() => pickStock(r)}>{r.name} <span className="dim">{handoutKind[r.kind]}</span></li>)}
                {stock.rows.length === 0 && <li className="dim">No Accessory, Consumable or License matches "{sq}"</li>}
              </ul>
            )}
          </section>
        )}
        {!user && (
          <>
            <ul className="pick-list" id="checkout-users" role="listbox" aria-label="Users">
              {shown.map((u, i) => (
                // A click keeps focus in the field; from the Options note it blurs the note first, so the note is kept.
                <li key={u.id} id={`checkout-user-${u.id}`} role="option" aria-selected={i === hi} className={i === hi ? 'sel' : undefined} onMouseDown={(e) => document.activeElement === field.current && e.preventDefault()} onClick={() => pick(u.id)}>{u.name}</li>
              ))}
            </ul>
            {/* Kept until changed or the app quits, across Users; shown on every confirm. */}
            <details className="options">
              <summary>Options{((!temp && o.expectedCheckin) || o.note) && <span className="dim"> · {[!temp && o.expectedCheckin && `Expected Checkin ${o.expectedCheckin}`, o.note && `Note: ${o.note}`].filter(Boolean).join(' · ')}</span>}</summary>
              <div className="actions">
                {/* Temp checkout's Expected Checkin is always its due time. */}
                {!temp && <input type="date" value={o.expectedCheckin} onChange={(e) => setStatus(flow.setOptions({ ...o, expectedCheckin: e.target.value }))} aria-label="Expected Checkin (optional)" title="Expected Checkin (optional)" />}
                <NoteOption note={o.note} onSet={(note) => setStatus(flow.setOptions({ ...o, note }))} />
              </div>
            </details>
          </>
        )}
        <RunningList rows={flow.runner.rows} paused={!!flow.runner.paused} doneLabel="checked out" undoBlocked={flow.runner.undoBlocked} clearBlocked={flow.runner.clearBlocked} onUndo={askUndo} onOpenAsset={onOpenAsset} onClear={() => flow.runner.clear()}
          what={(r) => (r.line ? <strong>{flow.summary(r)}</strong> : r.what || `To ${r.ctx.user.name}`)} />
        <p className="sr-only" aria-live="polite">{said ?? undoConfirm ?? flow.runner.announce}</p>
      </div>
      {choice
        ? <KeysPanel keys={[['Tab Enter', choice.fix], ['Esc', 'Stop']]} hint="Enter on the field and rescanning never move it. Scanning a different Asset Tag stops this one; nothing is written." />
        : open
        ? <KeysPanel keys={[['Enter', 'Confirm (or rescan the same tag)'], ['Esc', 'Cancel']]} hint="Scanning a different Asset Tag skips this one; nothing is written without a confirm." />
        : undoConfirm
        ? <KeysPanel keys={[['Enter', 'Undo'], ['Esc', 'Cancel']]} hint="Scanning another Asset Tag cancels the undo." />
        : user
        ? <KeysPanel keys={[['Enter', 'Scan'], ['Esc', 'Done for this User'], [UNDO_KEY, 'Undo last']]} hint={`Each scanned Asset is confirmed, then checked out to ${user.name}${temp ? ' until the due time' : ''}.${temp ? '' : ' Also hand out finds an Accessory, Consumable or License by name and sends it at once.'}`} />
        : <KeysPanel keys={[['Enter', 'Find User'], ['↑ ↓', 'Move the highlight'], [UNDO_KEY, 'Undo last']]} hint="Type a name, email or employee number, or scan an ID card." />}
    </div>
  )
}

// Repair intake (#59). The scan field takes each Asset Tag; a scanned Asset's confirm opens under it with the note
// field, which takes focus (the note is required), and gives it back to the scan field once confirmed or cancelled.
// Undo last (Ctrl+Z on the empty scan field, or the button) puts the newest intake back.
export function RepairIntakeView({ flow, field, repairTypeId, onOpenAsset, onSettings }: {
  flow: RepairIntake
  field: RefObject<HTMLInputElement | null>
  /** Settings' Maintenance type for repairs, the last step of the fallback chain. */
  repairTypeId: number | null
  onOpenAsset: (id: number) => void
  onSettings: () => void
}) {
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState('')
  const noteField = useRef<HTMLInputElement>(null)
  const open = flow.runner.open
  const key = open?.row.key
  useEffect(() => {
    flow.runner.enter()
    flow.open(repairTypeId)
    const back = () => document.activeElement === document.body && (noteField.current ?? field.current)?.focus()
    window.addEventListener('focus', back)
    return () => (window.removeEventListener('focus', back), flow.runner.leave())
  }, [])
  useEffect(() => {
    setNote('')
    ;(key ? noteField : field).current?.focus()
  }, [key])
  // Text that cleans away to nothing ("***") hasn't said what happened; a link stays, for the write to refuse.
  const stated = (v: string) => { try { return cleanText(v) ? v : '' } catch { return v } }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('')
    // Enter on the empty field confirms the open confirm (or Undo); a scan confirms its own tag, or skips the waiting one.
    if (!cleanTag(text)) return void (open ? setStatus(flow.runner.confirmOpen()) : flow.runner.confirm && undo())
    setStatus(flow.scan(text))
    setText('')
  }
  async function submitNote(e?: React.FormEvent) {
    e?.preventDefault()
    try { cleanText(note) } catch (err) { return setStatus((err as Error).message) }
    setStatus(await flow.runner.submitText(stated(note), null))
    setNote(flow.runner.open?.text ?? '')
  }
  function cancel() {
    flow.runner.cancelOpen()
    setStatus('')
  }
  function askUndo() {
    setStatus(flow.runner.askUndo())
    field.current?.focus()
  }
  function undo() {
    flow.runner.undo()
    field.current?.focus()
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && (open || flow.runner.confirm)) return e.preventDefault(), open ? cancel() : flow.runner.cancelUndo()
  }
  // Ctrl+Z only on the empty scan field: in the note field (or with text typed) it's the usual text undo.
  function onScanKeyDown(e: React.KeyboardEvent) {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !text) return e.preventDefault(), askUndo()
    onKeyDown(e)
  }

  const a = open?.row.before
  const undoConfirm = flow.runner.confirm
  const announce = open && `Confirm ${open.row.tag}: ${open.says}? Say what happened, then Enter. Esc to cancel.`
  return (
    <div className="workflow">
      <div className="workflow-main">
        <header className="head"><h1>Repair intake<span className="sub">Scan a broken Asset</span></h1></header>
        <form className="workflow-field" onSubmit={onSubmit}>
          <input ref={field} autoFocus className="search" value={text} onChange={(e) => { setText(e.target.value); setStatus('') }} onKeyDown={onScanKeyDown} placeholder="Scan the Asset Tag of a broken Asset" aria-label="Asset Tag" />
          {flow.blocked ? <p className="message error" role="alert">{flow.blocked}</p> : <p className="message" role="status">{status}</p>}
          <PauseBar runner={flow.runner} onSettings={onSettings} />
          {undoConfirm && (
            <div className="actions undo-confirm" role="group" aria-label="Undo last">
              <span>{undoConfirm}</span>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={undo}>Undo</button>
              <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={() => flow.runner.cancelUndo()}>Cancel</button>
            </div>
          )}
        </form>
        {open && a && (
          <form className="scan-confirm" aria-label="Confirm repair intake" onSubmit={submitNote}>
            <div className="confirm-tag mono">{a.assetTag}</div>
            <dl className="confirm-facts">
              {([['Name', a.name], ['Asset Model', a.model], ['Status Label', a.status], ['Assignee', a.assignee?.name ?? "Isn't checked out"]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}
            </dl>
            <p>→ {open.says}</p>
            <input ref={noteField} value={note} onChange={(e) => { setNote(e.target.value); flow.runner.setText(stated(e.target.value)); setStatus('') }} onKeyDown={onKeyDown}
              placeholder="What happened to the Asset (e.g. cracked screen, won't power on)" aria-label="What happened to the Asset (required)" aria-required="true" />
            <p className="dim">Describe the Asset, never the student: Snipe-IT keeps this in History for good.</p>
            <div className="actions">
              <button type="submit" onMouseDown={(e) => e.preventDefault()}>Confirm</button>
              <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Cancel</button>
            </div>
          </form>
        )}
        <RunningList rows={flow.runner.rows} paused={!!flow.runner.paused} doneLabel="taken in" undoBlocked={flow.runner.undoBlocked} clearBlocked={flow.runner.clearBlocked} onUndo={askUndo} onOpenAsset={onOpenAsset} onClear={() => flow.runner.clear()} what={(r) => r.what} />
        <p className="sr-only" aria-live="polite">{announce ?? undoConfirm ?? flow.runner.announce}</p>
      </div>
      {open
        ? <KeysPanel keys={[['Enter', 'Confirm (note required)'], ['Esc', 'Cancel']]} hint="Scanning a different Asset Tag skips this one; nothing is written without a confirm." />
        : undoConfirm
        ? <KeysPanel keys={[['Enter', 'Undo'], ['Esc', 'Cancel']]} hint="Scanning another Asset Tag cancels the undo." />
        : <KeysPanel keys={[['Enter', 'Scan'], [UNDO_KEY, 'Undo last']]} hint="Each scanned Asset is confirmed with what happened, then checked in as Damaged and a repair Maintenance opened. Undo last puts the newest one back." />}
    </div>
  )
}

// Incoming repair (#60). "Repaired by" is picked once for everything coming back from that Supplier. The scan field keeps focus through the confirm (scan,
// then Enter or the same tag again); Tab or a click reaches the Repair cost and Note, where Enter confirms too. An Asset
// that isn't Damaged opens a choice there instead: Make ready anyway (a click, or Tab to it and Enter) or Stop (Esc).
export function IncomingRepairView({ flow, field, repairTypeId, onOpenAsset, onSettings }: {
  flow: IncomingRepair
  field: RefObject<HTMLInputElement | null>
  /** Settings' Maintenance type for repairs, the last step of the fallback chain. */
  repairTypeId: number | null
  onOpenAsset: (id: number) => void
  onSettings: () => void
}) {
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState('')
  const [suppliers, setSuppliers] = useState<StatusLabel[]>([])
  const open = flow.runner.open
  const key = open?.row.key
  useEffect(() => {
    flow.runner.enter()
    flow.open(repairTypeId)
    flow.suppliers().then(setSuppliers, (e: Error) => setStatus(`Couldn't load the Suppliers: ${e.message}`))
    const back = () => document.activeElement === document.body && field.current?.focus()
    window.addEventListener('focus', back)
    return () => (window.removeEventListener('focus', back), flow.runner.leave())
  }, [])
  // A new confirm starts with an empty note; the scan field has focus again once one opens or closes.
  useEffect(() => {
    setNote('')
    field.current?.focus()
  }, [key])

  function askUndo() {
    setStatus(flow.runner.askUndo())
    field.current?.focus()
  }
  function undo() {
    flow.runner.undo()
    field.current?.focus()
  }
  function cancel() {
    flow.runner.cancelOpen()
    setStatus('')
    field.current?.focus()
  }
  const done = (said: string) => (setStatus(said), field.current?.focus())
  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('')
    // Enter on the empty field confirms the open confirm (never a choice's fix-it button) or the open Undo.
    if (!cleanTag(text)) return void (open ? setStatus(flow.runner.confirmOpen()) : flow.runner.confirm && undo())
    setStatus(flow.scan(text))
    setText('')
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && (open || flow.runner.confirm)) return e.preventDefault(), open ? cancel() : flow.runner.cancelUndo()
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !text) return e.preventDefault(), askUndo()
  }
  // Enter in the Repair cost or Note field confirms with what was typed; a scan landing there is caught as one.
  async function fieldKey(e: React.KeyboardEvent, submit: () => Promise<string>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const said = await submit()
    if (flow.runner.open?.row.key === key) setStatus(said)
    else done(said)
  }
  function pickSupplier(id: string) {
    flow.setSupplier(suppliers.find((s) => String(s.id) === id) ?? null)
    field.current?.focus()
  }

  const a = open?.row.before
  const choice = open?.choice
  const m = flow.found?.open
  const others = flow.found?.others ?? 0
  const days = m?.startDate ? Math.max(0, Math.round((Date.parse(localDate(new Date())) - Date.parse(m.startDate)) / 864e5)) : null
  const undoConfirm = flow.runner.confirm
  // The Supplier picked stays listed even when the list couldn't be loaded again.
  const listed = flow.supplier && !suppliers.some((s) => s.id === flow.supplier!.id) ? [flow.supplier, ...suppliers] : suppliers
  const said = open && (choice
    ? `${open.row.tag} is ${a?.status}, not Damaged. ${choice.fix}: click it, or Tab to it and Enter. Esc to Stop.`
    : `Confirm ${open.row.tag}: ${flow.says}? Enter or rescan to confirm, Esc to cancel.`)
  return (
    <div className="workflow">
      <div className="workflow-main">
        <header className="head">
          <h1>Incoming repair<span className="sub">Scan each Asset back from repair</span></h1>
          <div className="actions">
            <label className="dim">Repaired by{' '}
              <select value={flow.supplier?.id ?? ''} onChange={(e) => pickSupplier(e.target.value)} aria-label="Repaired by (Supplier)">
                <option value="">No Supplier</option>
                {listed.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
        </header>
        <form className="workflow-field" onSubmit={onSubmit}>
          <input ref={field} autoFocus className="search" value={text} onChange={(e) => { setText(e.target.value); setStatus('') }} onKeyDown={onKeyDown} placeholder="Scan the Asset Tag of an Asset back from repair" aria-label="Asset Tag" />
          {flow.blocked ? <p className="message error" role="alert">{flow.blocked}</p> : <p className="message" role="status">{status}</p>}
          <PauseBar runner={flow.runner} onSettings={onSettings} />
          {undoConfirm && (
            <div className="actions undo-confirm" role="group" aria-label="Undo last">
              <span>{undoConfirm}</span>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={undo}>Undo</button>
              <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={() => flow.runner.cancelUndo()}>Cancel</button>
            </div>
          )}
        </form>
        {open && a && (
          // The buttons don't take focus when clicked, so the next scan still lands in the field.
          <div className="scan-confirm" role="group" aria-label={choice ? 'Not Damaged' : 'Confirm incoming repair'} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), cancel())}>
            {choice && <p>This Asset is <strong>{a.status}</strong>, not Damaged.</p>}
            <div className="confirm-tag mono">{a.assetTag}</div>
            <dl className="confirm-facts">
              {([
                ['Asset Model', a.model], ['Status Label', a.status],
                ['Maintenance', m ? `Opened ${m.startDate ?? '(no date)'}${days === null ? '' : `, ${days} day${days === 1 ? '' : 's'} away`}${others ? ` (${others} other open)` : ''}` : 'None open'],
                ...(m ? [['Intake note', m.notes]] as const : []),
              ] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}
            </dl>
            <p>→ {flow.says}</p>
            <div className="actions">
              <label className="dim">Repair cost{' '}
                <input value={flow.cost} onChange={(e) => { flow.setCost(e.target.value); setStatus('') }} onKeyDown={(e) => fieldKey(e, () => flow.submitCost(flow.cost))}
                  inputMode="decimal" placeholder="Optional, e.g. 45" aria-label="Repair cost (optional)" title="What the repair cost, e.g. 45 or $45.00. Kept on the Maintenance, never as the purchase cost." />
              </label>
              <label className="dim">Note{' '}
                <input value={note} onChange={(e) => { setNote(e.target.value); flow.runner.setText(e.target.value); setStatus('') }} onKeyDown={(e) => fieldKey(e, () => flow.submitNote(note).then((said) => (setNote(flow.runner.open?.text ?? ''), said)))}
                  placeholder="Optional" aria-label="Note (optional)" />
              </label>
            </div>
            {choice ? (
              <div className="actions">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => done(flow.runner.fixOpen())}>{choice.fix}</button>
                <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Stop</button>
              </div>
            ) : (
              <div className="actions">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => done(flow.runner.confirmOpen())}>Confirm</button>
                <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Cancel</button>
              </div>
            )}
          </div>
        )}
        <RunningList rows={flow.runner.rows} paused={!!flow.runner.paused} doneLabel="made ready" undoBlocked={flow.runner.undoBlocked} clearBlocked={flow.runner.clearBlocked} onUndo={askUndo} onOpenAsset={onOpenAsset} onClear={() => flow.runner.clear()} what={(r) => r.what} />
        <p className="sr-only" aria-live="polite">{said ?? undoConfirm ?? flow.runner.announce}</p>
      </div>
      {choice
        ? <KeysPanel keys={[['Tab Enter', choice.fix], ['Esc', 'Stop']]} hint="Enter on the field and rescanning never make it ready. Scanning a different Asset Tag stops this one; nothing is written." />
        : open
        ? <KeysPanel keys={[['Enter', 'Confirm (or rescan the same tag)'], ['Tab', 'Repair cost, then Note'], ['Esc', 'Cancel']]} hint="Scanning a different Asset Tag skips this one; nothing is written without a confirm." />
        : undoConfirm
        ? <KeysPanel keys={[['Enter', 'Undo'], ['Esc', 'Cancel']]} hint="Scanning another Asset Tag cancels the undo." />
        : <KeysPanel keys={[['Enter', 'Scan'], [UNDO_KEY, 'Undo last']]} hint="Each scanned Asset is confirmed, then made Ready to Deploy and its repair Maintenance closed. Undo last puts the newest one back." />}
    </div>
  )
}

// The Options note: typed freely, kept (and checked) when the field is left, so a half-typed link isn't refused per key.
function NoteOption({ note, onSet }: { note: string; onSet: (note: string) => void }) {
  const [draft, setDraft] = useState(note)
  return <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => onSet(draft)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onSet(draft))} placeholder="Note (optional)" aria-label="Checkout note (optional)" />
}
