import { useState } from 'react'
import type { AssetSummary, StatusLabel } from '../../main/snipeit'
import { CheckoutForm, NOT_ALLOWED, StatusChip } from './App'

/** How one Asset in the batch fared in the last Checkout or Checkin. */
export type Outcome = { state: 'working' } | { state: 'done'; text: string } | { state: 'failed'; reason: string }

// Runs the action on each Asset in turn and reports each outcome as it lands; one failing doesn't stop the rest, stop() does.
// Each is the usual single Checkout or Checkin, so History credits the Operator for every one.
// ponytail: one at a time, gentle on Snipe-IT's rate limit (a Checkout is two requests); a cart of 30 takes ~20s on a busy server.
export async function eachInTurn(ids: number[], work: (id: number) => Promise<void>, done: string, report: (id: number, outcome: Outcome) => void, stop = () => false) {
  for (const id of ids) {
    if (stop()) return
    report(id, { state: 'working' })
    try {
      await work(id)
      report(id, { state: 'done', text: done })
    } catch (e) {
      report(id, { state: 'failed', reason: (e as Error).message })
    }
  }
}

/** An Asset in the batch, with how it fared in the last run (none until then, or after it's added again). */
export type BatchItem = AssetSummary & { outcome?: Outcome }
export type BatchAction = { done: string; work: (id: number) => Promise<void> }

// App holds the batch and its run (session only, like recent scans), so leaving this page mid-run loses nothing.
// Scanning while this page is open adds to it.
export function BatchView({ batch, busy, last, onRun, onRemove, onClear, statusLabels, locations, defaultLocation, onOpenAsset }: {
  batch: BatchItem[]
  busy: boolean
  last: BatchAction | null
  onRun: (action: BatchAction, ids: number[]) => Promise<void>
  onRemove: (ids: number[]) => void
  onClear: () => void
  statusLabels: StatusLabel[]
  locations: StatusLabel[]
  defaultLocation: StatusLabel | null
  onOpenAsset: (id: number) => void
}) {
  const [checkingOut, setCheckingOut] = useState(false)
  const [statusId, setStatusId] = useState<number | undefined>()
  const [locationId, setLocationId] = useState(defaultLocation?.id)
  const [note, setNote] = useState('')

  const run = (action: BatchAction) => onRun(action, batch.map((a) => a.id))
  const failed = batch.filter((a) => a.outcome?.state === 'failed')
  const done = batch.filter((a) => a.outcome?.state === 'done')
  const off = busy || batch.length === 0
  // Snipe-IT would refuse each one anyway; saying so up front beats a run of failed rows.
  const cantCheckout = batch.some((a) => !a.can.checkout)
  const cantCheckin = batch.some((a) => !a.can.checkin)

  return (
    <>
      <header className="head">
        <h1>Batch</h1>
        <span className="dim mono">{batch.length} {batch.length === 1 ? 'Asset' : 'Assets'}</span>
        <div className="actions">
          {/* Retry repeats the same action; to change it (another User, a Location…), keep only the failed ones and act again. */}
          {last && failed.length > 0 && !busy && <button title="Runs the same Checkout or Checkin again on the ones that failed" onClick={() => onRun(last, failed.map((a) => a.id))}>Retry failed ({failed.length})</button>}
          {done.length > 0 && !busy && <button className="quiet" onClick={() => onRemove(done.map((a) => a.id))}>Remove the ones that worked</button>}
          <button disabled={off || cantCheckout} title={cantCheckout ? NOT_ALLOWED : undefined} onClick={() => setCheckingOut((o) => !o)}>{checkingOut ? 'Cancel' : 'Checkout all…'}</button>
          <button className="quiet" disabled={off} onClick={onClear}>Clear</button>
        </div>
        <form className="actions" onSubmit={(e) => (e.preventDefault(), run({ done: 'Checked in', work: (id) => window.snipeIt.checkin(id, { statusId, locationId, note }) }))}>
          <select value={statusId ?? ''} onChange={(e) => setStatusId(e.target.value ? Number(e.target.value) : undefined)} disabled={off} aria-label="Status after Checkin">
            <option value="">Keep each Asset's status</option>
            {statusLabels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label="Checkin Location" disabled={off} value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Keep current Location</option>
            {defaultLocation && !locations.some((l) => l.id === defaultLocation.id) && <option value={defaultLocation.id}>{defaultLocation.name}</option>}
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} disabled={off} placeholder="Note (optional)" aria-label="Checkin note" />
          <button disabled={off || cantCheckin} title={cantCheckin ? NOT_ALLOWED : undefined}>{busy ? 'Working…' : 'Checkin all'}</button>
        </form>
      </header>
      {checkingOut && batch.length > 0 && (
        // Disabled while any run is going, so a Checkout can't start on top of a Checkin.
        <fieldset className="plain" disabled={busy}>
          <CheckoutForm defaultLocation={defaultLocation} onCheckout={(o) => run({ done: 'Checked out', work: (id) => window.snipeIt.checkout(id, o) })} />
        </fieldset>
      )}
      <table className="history batch">
        <thead>
          <tr><th>Asset Tag</th><th>Name</th><th>Status when added</th><th>Result</th><th /></tr>
        </thead>
        <tbody>
          {batch.map((a) => {
            const o = a.outcome
            return (
              <tr key={a.id}>
                <td><button className="link mono" onClick={() => onOpenAsset(a.id)}>{a.assetTag}</button></td>
                <td>{a.name || '—'}</td>
                <td><StatusChip asset={a} /> <span className="dim">{a.assignee?.name ?? 'Unassigned'}</span></td>
                <td role="status">
                  {o?.state === 'working' && <span className="dim">Working…</span>}
                  {o?.state === 'done' && <span className="chip c-green">{o.text}</span>}
                  {o?.state === 'failed' && <span className="late">{o.reason}</span>}
                </td>
                <td><button className="link" disabled={busy} onClick={() => onRemove([a.id])} aria-label={`Remove ${a.assetTag} from the batch`}>Remove</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {batch.length === 0 && <p className="empty">Scan Asset Tags to add them to the batch</p>}
    </>
  )
}
