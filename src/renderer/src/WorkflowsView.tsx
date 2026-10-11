import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { ArchiveRestore, type LucideIcon } from 'lucide-react'
import { WORKFLOWS, type Workflow } from '../../main/notes'
import type { StatusLabel } from '../../main/snipeit'
import { OutcomeText } from './BatchView'
import { cleanTag, type BulkReturn, type Row } from './workflows'

// The Workflows built so far; the rest join as they're built. Ctrl+N follows glossary order from the start (WORKFLOWS).
export const BUILT: Workflow[] = ['Bulk return']
export const workflowIcon: Partial<Record<Workflow, LucideIcon>> = { 'Bulk return': ArchiveRestore }
const about: Partial<Record<Workflow, string>> = { 'Bulk return': 'Pick where returns go, then scan Assets to check them in.' }
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
          {rows.map((r) => (
            <tr key={r.key} className={r.result.state === 'failed' ? 'failed' : undefined}>
              <td className="dim">{r.time}</td>
              <td>{r.assetId === null ? <span className="mono">{r.tag}</span> : <button className="link mono" onClick={() => onOpenAsset(r.assetId!)}>{r.tag}</button>}</td>
              <td>{r.name || '—'}</td>
              <td>{what(r)}</td>
              <td>
                {r.result.state === 'waiting' ? <span className="dim">Waiting…</span> : r.result.state === 'undone' ? <span className="dim">Undone</span> : <OutcomeText outcome={r.result} />}
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
