import { useEffect, useState, type RefObject } from 'react'
import { ArchiveRestore, type LucideIcon } from 'lucide-react'
import { WORKFLOWS, type Workflow } from '../../main/notes'
import type { StatusLabel } from '../../main/snipeit'
import { OutcomeText } from './BatchView'
import type { BulkReturn, Row } from './workflows'

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
export function WorkflowsPage({ done, onOpen }: { done: (w: Workflow) => number; onOpen: (w: Workflow) => void }) {
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
              {done(w) > 0 && <span className="dim">{done(w)} done this session</span>}
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

const settled = (r: Row) => r.result.state === 'done' || r.result.state === 'failed'

// One Workflow's Running list, newest first. what: the Workflow's "what" cell for a row.
export function RunningList<C>({ rows, doneLabel, what, onOpenAsset, onClear }: {
  rows: Row<C>[]
  doneLabel: string
  what: (r: Row<C>) => string
  onOpenAsset: (id: number) => void
  onClear: () => void
}) {
  const done = rows.filter((r) => r.result.state === 'done').length
  const busy = rows.some((r) => !settled(r))
  return (
    <>
      <div className="section running-head">
        <span>{done} {doneLabel}</span>
        <div className="actions"><button className="quiet" disabled={busy || rows.length === 0} title={busy ? 'Waits until nothing is waiting or working' : undefined} onClick={onClear}>Clear</button></div>
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
              <td>{r.result.state === 'waiting' ? <span className="dim">Waiting…</span> : <OutcomeText outcome={r.result} />}</td>
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
  const hi = moved?.q === q ? moved.i : q ? 0 : shown.findIndex((l) => l.id === flow.last?.id)
  useEffect(() => { setText(''); setMoved(null); field.current?.focus() }, [step])
  useEffect(() => {
    const back = () => document.activeElement === document.body && field.current?.focus()
    window.addEventListener('focus', back)
    return () => window.removeEventListener('focus', back)
  }, [])

  async function pick(location: StatusLabel) {
    setStatus('')
    setStatus(await flow.start(location).catch((e: Error) => e.message))
  }
  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (step.step === 'scan') return setStatus(flow.scan(text)), setText('')
    if (shown[hi]) return pick(shown[hi])
    setStatus(q ? `No Location matches '${text.trim()}'. Pick the Location first.` : 'Pick the Location returns go to.')
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (step.step !== 'location' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !shown.length) return
    e.preventDefault()
    setMoved({ q, i: e.key === 'ArrowDown' ? Math.min(hi + 1, shown.length - 1) : Math.max(hi - 1, 0) })
  }

  const scanning = step.step === 'scan'
  const here = scanning ? step.location : null
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
        </form>
        {here ? (
          <RunningList rows={flow.runner.rows} doneLabel="checked in" onOpenAsset={onOpenAsset} onClear={() => flow.runner.clear()}
            // A row's Location shows only when it differs from the current one (after Change Location).
            what={(r) => (r.ctx.id === here.id ? r.what : [r.what, `to ${r.ctx.name}`].filter(Boolean).join(', '))} />
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
        <p className="sr-only" aria-live="polite">{flow.runner.announce}</p>
      </div>
      {here
        ? <KeysPanel keys={[['Enter', 'Check in']]} hint="Each scanned Asset is checked in at once, set to Ready to Deploy." />
        : <KeysPanel keys={[['Enter', 'Pick Location'], ['↑ ↓', 'Move the highlight']]} hint="Type to filter the Locations." />}
    </div>
  )
}
