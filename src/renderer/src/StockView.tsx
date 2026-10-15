import { useEffect, useState } from 'react'
import type { HeldAccessory, AccessoryCheckout, RecordKind, ReturnedLine } from '../../main/snipeit'
import { NOT_ALLOWED } from './App'

// Runs one Checkin, then has the page reload; a refusal shows as Snipe-IT's reason.
function useCheckin(onChanged: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  async function checkin(work: (note: string) => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await work(note)
      setNote('')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, checkin, noteInput: <input value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Checkin note (optional)" aria-label="Checkin note" /> }
}

/** The stocked kinds whose units come back: an Accessory's units, a License's seats. */
export type HeldKind = 'accessories' | 'licenses'
// How each kind lists its holders and takes a unit back, on its own page and on a User's.
const HELD: Record<HeldKind, { title: string; holders: (id: number) => Promise<AccessoryCheckout[]>; checkin: (id: number, rowId: number, note: string) => Promise<void>; held: (userId: number) => Promise<HeldAccessory[]>; back: (id: number, userId: number, note: string) => Promise<void> }> = {
  accessories: { title: 'Accessories checked out', holders: (id) => window.snipeIt.accessoryHolders(id), checkin: (_id, rowId, note) => window.snipeIt.checkinAccessory(rowId, note), held: (userId) => window.snipeIt.userAccessories(userId), back: (id, userId, note) => window.snipeIt.returnAccessory(id, userId, 1, note) },
  licenses: { title: 'Licenses checked out', holders: (id) => window.snipeIt.licenseHolders(id), checkin: (id, rowId, note) => window.snipeIt.checkinLicense(id, rowId, note), held: (userId) => window.snipeIt.userLicenses(userId), back: (id, userId, note) => window.snipeIt.returnLicense(id, userId, note) },
}

// Who holds each unit of an Accessory (seat of a License), each checked in on its own. version: bumped when a Checkout or Checkin changed them.
export function HoldersSection({ kind, id, canCheckin, version, onChanged, onOpenRecord }: { kind: HeldKind; id: number; canCheckin: boolean; version: number; onChanged: () => void; onOpenRecord: (kind: RecordKind, id: number) => void }) {
  const [holders, setHolders] = useState<AccessoryCheckout[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const { busy, error, checkin, noteInput } = useCheckin(onChanged)
  useEffect(() => {
    let stale = false
    HELD[kind].holders(id).then((h) => !stale && (setHolders(h), setLoadError('')), (e: Error) => !stale && setLoadError(e.message))
    return () => { stale = true }
  }, [kind, id, version])

  return (
    <section className="access">
      <div className="section">Checked out to</div>
      {(loadError || error) && <p className="message error" role="alert">{loadError || error}</p>}
      {holders && holders.length === 0 && <p className="dim stock-note">Nobody has one</p>}
      {holders && holders.length > 0 && (
        <>
          <div className="actions stock-note">{noteInput}</div>
          <table className="history">
            <thead><tr><th>Assignee</th><th>Since</th><th>Note</th><th /></tr></thead>
            <tbody>
              {holders.map((h) => (
                <tr key={h.rowId}>
                  <td>{h.assignee.type === 'user' ? <button className="link" onClick={() => onOpenRecord('users', h.assignee.id)}>{h.assignee.name}</button> : h.assignee.name}</td>
                  <td>{h.since}</td>
                  <td>{h.note}</td>
                  <td><div className="actions"><button disabled={busy || !canCheckin} title={canCheckin ? undefined : NOT_ALLOWED} onClick={() => checkin((note) => HELD[kind].checkin(id, h.rowId, note))}>Checkin</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

// Check in everything (#190): every Accessory unit and License seat the User holds, one Checkin at a time with one note,
// and a line per thing saying what happened; nothing is rolled back. Assets are Bulk return's. onChanged: when it ends.
export function UserReturnAll({ userId, onChanged }: { userId: number; onChanged: () => void }) {
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<ReturnedLine[] | null>(null)
  const [error, setError] = useState('')
  async function run() {
    setBusy(true)
    setError('')
    try {
      setLines(await window.snipeIt.returnAll(userId, note))
      setAsking(false)
      setNote('')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="access">
      <div className="actions stock-note">
        <button disabled={busy} onClick={() => (setAsking((a) => !a), setLines(null))}>{asking ? 'Cancel' : 'Check in everything…'}</button>
        {asking && (
          <>
            <input value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Checkin note (optional)" aria-label="Checkin note" />
            <button disabled={busy} onClick={run}>{busy ? 'Checking in…' : 'Check in every Accessory and License seat'}</button>
          </>
        )}
      </div>
      {error && <p className="message error" role="alert">{error}</p>}
      {lines && lines.length === 0 && <p className="dim stock-note" role="status">Nothing to check in</p>}
      {lines && lines.length > 0 && (
        <ul className="stock-note" role="status">
          {lines.map((l, i) => <li key={i} className={l.failed ? 'late' : undefined}>{l.name}: {l.outcome}</li>)}
        </ul>
      )}
    </section>
  )
}

// The Accessories (Licenses) a User holds; Checkin takes back one unit (seat) at a time, their oldest first.
// version: bumped by Check in everything, so the list reloads.
export function UserHeldSection({ kind, userId, version = 0, onOpenRecord }: { kind: HeldKind; userId: number; version?: number; onOpenRecord: (kind: RecordKind, id: number) => void }) {
  const [held, setHeld] = useState<HeldAccessory[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [own, setOwn] = useState(0)
  const { busy, error, checkin, noteInput } = useCheckin(() => setOwn((v) => v + 1))
  useEffect(() => {
    let stale = false
    HELD[kind].held(userId).then((h) => !stale && (setHeld(h), setLoadError('')), (e: Error) => !stale && setLoadError(e.message))
    return () => { stale = true }
  }, [kind, userId, version, own])

  return (
    <section className="access">
      <div className="section">{HELD[kind].title}</div>
      {(loadError || error) && <p className="message error" role="alert">{loadError || error}</p>}
      {held && held.length === 0 && <p className="dim stock-note">None</p>}
      {held && held.length > 0 && (
        <>
          <div className="actions stock-note">{noteInput}</div>
          <table className="history">
            <thead><tr><th>{kind === 'licenses' ? 'License' : 'Accessory'}</th><th>How many</th><th /></tr></thead>
            <tbody>
              {held.map((a) => (
                <tr key={a.id}>
                  <td><button className="link" onClick={() => onOpenRecord(kind, a.id)}>{a.name}</button></td>
                  <td>{a.count}</td>
                  <td><div className="actions"><button disabled={busy || !a.can.checkin} title={a.can.checkin ? undefined : NOT_ALLOWED} onClick={() => checkin((note) => HELD[kind].back(a.id, userId, note))}>Checkin one</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
