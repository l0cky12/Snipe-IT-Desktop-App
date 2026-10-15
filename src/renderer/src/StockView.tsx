import { useEffect, useState } from 'react'
import type { HeldAccessory, AccessoryCheckout, RecordKind } from '../../main/snipeit'
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

// Who holds each unit of an Accessory, each checked in on its own. version: bumped when a Checkout or Checkin changed them.
export function HoldersSection({ id, canCheckin, version, onChanged, onOpenRecord }: { id: number; canCheckin: boolean; version: number; onChanged: () => void; onOpenRecord: (kind: RecordKind, id: number) => void }) {
  const [holders, setHolders] = useState<AccessoryCheckout[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const { busy, error, checkin, noteInput } = useCheckin(onChanged)
  useEffect(() => {
    let stale = false
    window.snipeIt.accessoryHolders(id).then((h) => !stale && (setHolders(h), setLoadError('')), (e: Error) => !stale && setLoadError(e.message))
    return () => { stale = true }
  }, [id, version])

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
                  <td><div className="actions"><button disabled={busy || !canCheckin} title={canCheckin ? undefined : NOT_ALLOWED} onClick={() => checkin((note) => window.snipeIt.checkinAccessory(h.rowId, note))}>Checkin</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}

// The Accessories a User holds; Checkin takes back one at a time, their oldest first.
export function UserAccessoriesSection({ userId, onOpenRecord }: { userId: number; onOpenRecord: (kind: RecordKind, id: number) => void }) {
  const [held, setHeld] = useState<HeldAccessory[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [version, setVersion] = useState(0)
  const { busy, error, checkin, noteInput } = useCheckin(() => setVersion((v) => v + 1))
  useEffect(() => {
    let stale = false
    window.snipeIt.userAccessories(userId).then((h) => !stale && (setHeld(h), setLoadError('')), (e: Error) => !stale && setLoadError(e.message))
    return () => { stale = true }
  }, [userId, version])

  return (
    <section className="access">
      <div className="section">Accessories checked out</div>
      {(loadError || error) && <p className="message error" role="alert">{loadError || error}</p>}
      {held && held.length === 0 && <p className="dim stock-note">None</p>}
      {held && held.length > 0 && (
        <>
          <div className="actions stock-note">{noteInput}</div>
          <table className="history">
            <thead><tr><th>Accessory</th><th>How many</th><th /></tr></thead>
            <tbody>
              {held.map((a) => (
                <tr key={a.id}>
                  <td><button className="link" onClick={() => onOpenRecord('accessories', a.id)}>{a.name}</button></td>
                  <td>{a.count}</td>
                  <td><div className="actions"><button disabled={busy || !a.can.checkin} title={a.can.checkin ? undefined : NOT_ALLOWED} onClick={() => checkin((note) => window.snipeIt.returnAccessory(a.id, userId, 1, note))}>Checkin one</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
