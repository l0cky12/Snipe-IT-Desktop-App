import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArchiveRestore, PackageCheck, type LucideIcon } from 'lucide-react'
import { WORKFLOWS, workflowNote, type Workflow } from '../../main/notes'
import type { StatusLabel } from '../../main/snipeit'
import { OutcomeText } from './BatchView'
import { cleanTag, fieldKey, type BulkCheckout, type BulkReturn, type Row } from './workflows'

// The Workflows built so far; the rest join as they're built. Ctrl+N follows glossary order from the start (WORKFLOWS).
export const BUILT: Workflow[] = ['Bulk checkout', 'Bulk return']
export const workflowIcon: Partial<Record<Workflow, LucideIcon>> = { 'Bulk checkout': PackageCheck, 'Bulk return': ArchiveRestore }
const about: Partial<Record<Workflow, string>> = {
  'Bulk checkout': 'Find a User, then scan Assets and confirm each to check it out to them.',
  'Bulk return': 'Pick where returns go, then scan Assets to check them in.',
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

// One Workflow's Running list, newest first, with Undo last and Clear. what: the Workflow's "what" cell for a row.
// undoBlocked, clearBlocked: why each button is off ('' when it isn't).
export function RunningList<C>({ rows, doneLabel, what, undoBlocked, clearBlocked, onUndo, onOpenAsset, onClear }: {
  rows: Row<C>[]
  doneLabel: string
  what: (r: Row<C>) => ReactNode
  undoBlocked: string
  clearBlocked: string
  onUndo: () => void
  onOpenAsset: (id: number) => void
  onClear: () => void
}) {
  const done = rows.filter((r) => r.result.state === 'done').length
  return (
    <>
      <div className="section running-head">
        <span>{done} {doneLabel}</span>
        <div className="actions">
          <button className="quiet" disabled={!!undoBlocked} title={undoBlocked ? `${undoBlocked}. ${UNDO_TIP}` : UNDO_TIP} onClick={onUndo}>Undo last</button>
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
                {r.result.state === 'waiting' ? <span className="dim">Waiting…</span>
                  : r.result.state === 'confirm' ? <span className="dim">Waiting for confirm</span>
                  : r.result.state === 'undone' ? <span className="dim">Undone</span>
                  : r.result.state === 'neutral' ? <span className="dim">{r.result.text}</span>
                  : <OutcomeText outcome={r.result} />}
                {r.undoFailed && <> <span className="late">Undo failed: {r.undoFailed}</span></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="empty">Nothing scanned yet</p>}
    </>
  )
}

// Bulk return (#58). The field is never disabled and takes focus on every step change and when the window comes back,
// so the scanner's next keystrokes always land in it.
export function BulkReturnView({ flow, locations, field, onOpenAsset, onDone }: {
  flow: BulkReturn
  locations: StatusLabel[]
  field: RefObject<HTMLInputElement | null>
  onOpenAsset: (id: number) => void
  onDone: () => void
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
          <RunningList rows={flow.runner.rows} doneLabel="checked in" undoBlocked={flow.runner.undoBlocked} clearBlocked={flow.runner.clearBlocked} onUndo={askUndo} onOpenAsset={onOpenAsset} onClear={() => flow.runner.clear()}
            what={(r) => (
              <>
                {/* A row's Location shows only when it differs from the current one (after Change Location). */}
                {r.ctx.id === here.id ? r.what : [r.what, `to ${r.ctx.name}`].filter(Boolean).join(', ')}
                {/* Came back after its Expected Checkin, from the lookup answer; a refused Asset didn't come back. */}
                {r.before?.overdueDays != null && (r.result.state === 'done' || r.result.state === 'undone') && <> <span className="chip c-red">Overdue</span></>}
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

// Bulk checkout (#57). Step 1 finds the User (exact match on Enter, else Snipe-IT's picker list as the Operator types);
// step 2 scans Assets for them, each confirmed in place under the field, which keeps focus so no scan is lost.
export function BulkCheckoutView({ flow, field, onOpenAsset }: {
  flow: BulkCheckout
  field: RefObject<HTMLInputElement | null>
  onOpenAsset: (id: number) => void
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  // The picker list and the text it's for; an answer for older text is never shown against newer text.
  const [list, setList] = useState<{ q: string; users: StatusLabel[] } | null>(null)
  const [moved, setMoved] = useState<{ q: string; i: number } | null>(null)
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
    setText(''); setList(null); setMoved(null); field.current?.focus()
  }, [fieldKey(step)])
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
  const who = (u: { username: string; employeeNum: string }) => [u.username, u.employeeNum && `#${u.employeeNum}`].filter(Boolean).join(', ')
  const a = open?.row.before
  const ctx = open?.row.ctx
  const said = open && `Confirm ${open.row.tag}: Checkout to ${open.row.ctx.user.name}? Enter or rescan to confirm, Esc to cancel.`
  return (
    <div className="workflow">
      <div className="workflow-main">
        <header className="head">
          {user ? (
            <h1>{user.name}<span className="sub">{[who(user), `holds ${user.assets} Asset${user.assets === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span></h1>
          ) : (
            <h1>Bulk checkout<span className="sub">Who are the Assets for?</span></h1>
          )}
          {user && <div className="actions"><button className="quiet" onClick={() => (flow.done(), setStatus(''))}>Done</button></div>}
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
          {open && a && (
            // The buttons don't take focus either, so the next scan still lands in the field.
            <div className="scan-confirm" role="group" aria-label="Confirm checkout">
              <div className="confirm-tag mono">{a.assetTag}</div>
              <dl className="confirm-facts">
                {([['Name', a.name], ['Asset Model', a.model], ['Serial', a.serial], ['Status Label', a.status]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}
              </dl>
              <p>→ Checkout to <strong>{ctx!.user.name}</strong>{who(ctx!.user) && ` (${who(ctx!.user)})`}</p>
              {(ctx!.expectedCheckin || ctx!.note) && (
                <p className="dim">{[ctx!.expectedCheckin && `Expected Checkin ${ctx!.expectedCheckin}`, ctx!.note && `Note: ${workflowNote('Bulk checkout', { text: ctx!.note })}`].filter(Boolean).join(' · ')}</p>
              )}
              <div className="actions">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={confirm}>Confirm</button>
                <button type="button" className="quiet" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Cancel</button>
              </div>
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
        {!user && (
          <>
            <ul className="pick-list" id="checkout-users" role="listbox" aria-label="Users">
              {shown.map((u, i) => (
                <li key={u.id} id={`checkout-user-${u.id}`} role="option" aria-selected={i === hi} className={i === hi ? 'sel' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(u.id)}>{u.name}</li>
              ))}
            </ul>
            {/* Kept until changed or the app quits, across Users; shown on every confirm. */}
            <details className="options">
              <summary>Options{(o.expectedCheckin || o.note) && <span className="dim"> · {[o.expectedCheckin && `Expected Checkin ${o.expectedCheckin}`, o.note && `Note: ${o.note}`].filter(Boolean).join(' · ')}</span>}</summary>
              <div className="actions">
                <input type="date" value={o.expectedCheckin} onChange={(e) => setStatus(flow.setOptions({ ...o, expectedCheckin: e.target.value }))} aria-label="Expected Checkin (optional)" title="Expected Checkin (optional)" />
                <NoteOption note={o.note} onSet={(note) => setStatus(flow.setOptions({ ...o, note }))} />
              </div>
            </details>
          </>
        )}
        <RunningList rows={flow.runner.rows} doneLabel="checked out" undoBlocked={flow.runner.undoBlocked} clearBlocked={flow.runner.clearBlocked} onUndo={askUndo} onOpenAsset={onOpenAsset} onClear={() => flow.runner.clear()}
          what={(r) => (r.line ? <strong>{flow.summary(r)}</strong> : r.what || `To ${r.ctx.user.name}`)} />
        <p className="sr-only" aria-live="polite">{said ?? undoConfirm ?? flow.runner.announce}</p>
      </div>
      {open
        ? <KeysPanel keys={[['Enter', 'Confirm (or rescan the same tag)'], ['Esc', 'Cancel']]} hint="Scanning a different Asset Tag skips this one; nothing is written without a confirm." />
        : undoConfirm
        ? <KeysPanel keys={[['Enter', 'Undo'], ['Esc', 'Cancel']]} hint="Scanning another Asset Tag cancels the undo." />
        : user
        ? <KeysPanel keys={[['Enter', 'Scan'], ['Esc', 'Done for this User'], [UNDO_KEY, 'Undo last']]} hint={`Each scanned Asset is confirmed, then checked out to ${user.name}.`} />
        : <KeysPanel keys={[['Enter', 'Find User'], ['↑ ↓', 'Move the highlight'], [UNDO_KEY, 'Undo last']]} hint="Type a name, email or employee number, or scan an ID card." />}
    </div>
  )
}

// The Options note: typed freely, kept (and checked) when the field is left, so a half-typed link isn't refused per key.
function NoteOption({ note, onSet }: { note: string; onSet: (note: string) => void }) {
  const [draft, setDraft] = useState(note)
  return <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => onSet(draft)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onSet(draft))} placeholder="Note (optional)" aria-label="Checkout note (optional)" />
}
