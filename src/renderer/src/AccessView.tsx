import { useEffect, useState } from 'react'
import { PERMISSIONS, type Group, type StatusLabel, type UserAccess } from '../../main/snipeit'

/** Whether the Operator's account may manage permissions: null until Snipe-IT says; error when it couldn't be asked. */
export type CanManage = boolean | null | { error: string }
// What the check's answer means on screen: nothing yet, the superuser notice, or why it couldn't be checked.
function AccessNotice({ canManage }: { canManage: CanManage }) {
  if (canManage === false) return <p className="notice" role="status">{CANT_MANAGE}</p>
  if (canManage && typeof canManage === 'object') return <p className="message error" role="alert">Couldn't check whether your account can manage permissions: {canManage.error}</p>
  return null
}

// Said wherever permissions could be managed but the Operator's account can't.
export const CANT_MANAGE = "Managing permissions needs a Snipe-IT superuser account. Yours isn't one, so groups and their permissions can't be changed from here; ask a Snipe-IT superuser."

// "assets.view.requestable" → "View requestable" under Assets: the prefix every key of the area shares goes. Global's keys
// share none, so "reports.view" reads "Reports view".
const permissionLabel = (key: string, keys: string[]) => {
  const prefix = key.split('.')[0] + '.'
  const text = (keys.every((k) => k.startsWith(prefix)) ? key.slice(prefix.length) : key).replace(/[._]/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// A User's groups and permissions of their own; a superuser can add and remove groups here.
export function UserAccessSection({ userId, canManage: check }: { userId: number; canManage: CanManage }) {
  const canManage = check === true
  const [access, setAccess] = useState<UserAccess | null>(null)
  const [all, setAll] = useState<StatusLabel[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stale = false
    window.snipeIt.userAccess(userId).then((a) => !stale && setAccess(a), (e: Error) => !stale && setError(e.message))
    if (canManage) window.snipeIt.groups().then((g) => !stale && setAll(g), (e: Error) => !stale && setError(e.message))
    return () => { stale = true }
  }, [userId, canManage])

  async function change(groups: StatusLabel[]) {
    setBusy(true)
    setError('')
    try {
      await window.snipeIt.setUserGroups(userId, groups.map((g) => g.id))
      setAccess((a) => a && { ...a, groups })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const own = Object.entries(access?.permissions ?? {})
  return (
    <section className="access">
      <div className="section">Permissions and groups</div>
      {error && <p className="message error" role="alert">{error}</p>}
      <AccessNotice canManage={check} />
      {access && (
        <div className="access-body">
          <div className="k">Groups</div>
          <div className="actions">
            {access.groups.length === 0 && <span className="dim">None</span>}
            {access.groups.map((g) => (
              <span key={g.id} className="chip c-blue">
                {g.name}
                {canManage && <button className="chip-x" disabled={busy} onClick={() => change(access.groups.filter((x) => x.id !== g.id))} aria-label={`Remove from ${g.name}`}>×</button>}
              </span>
            ))}
            {canManage && (
              <select value="" disabled={busy} aria-label="Add to a group"
                onChange={(e) => { const g = all.find((x) => String(x.id) === e.target.value); if (g) change([...access.groups, g]) }}>
                <option value="">Add to a group…</option>
                {all.filter((g) => !access.groups.some((x) => x.id === g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>
          <div className="k">Permissions of their own</div>
          {own.length === 0
            ? <p className="dim">None; everything they may do comes from their groups.</p>
            : <ul className="permissions">{own.map(([k, v]) => <li key={k}><span className={`chip ${v === '1' ? 'c-green' : 'c-red'}`}>{v === '1' ? 'Granted' : 'Denied'}</span> <span className="mono">{k}</span></li>)}</ul>}
        </div>
      )}
    </section>
  )
}

// Every permission group, and one group's permissions to edit (Snipe-IT lets only a superuser do either).
export function GroupsView({ canManage: check }: { canManage: CanManage }) {
  const canManage = check === true
  const [groups, setGroups] = useState<StatusLabel[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!canManage) return
    let stale = false
    window.snipeIt.groups().then((g) => !stale && setGroups(g), (e: Error) => !stale && setError(e.message))
    return () => { stale = true }
  }, [canManage])

  if (open !== null) return <GroupEditor id={open} onDone={(renamed) => (setOpen(null), renamed && setGroups((g) => g?.map((x) => (x.id === renamed.id ? renamed : x)) ?? g))} />
  return (
    <>
      <header className="head"><h1>Permission groups</h1></header>
      {check === null && <p className="empty">Checking your account…</p>}
      <AccessNotice canManage={check} />
      {error && <p className="message error" role="alert">{error}</p>}
      {groups && (
        <div className="records">
          {groups.map((g) => <button key={g.id} className="record-kind" onClick={() => setOpen(g.id)}>{g.name}</button>)}
          {groups.length === 0 && <p className="empty">No groups</p>}
        </div>
      )}
    </>
  )
}

function GroupEditor({ id, onDone }: { id: number; onDone: (saved: StatusLabel | null) => void }) {
  const [group, setGroup] = useState<Group | null>(null)
  const [name, setName] = useState('')
  const [granted, setGranted] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let stale = false
    window.snipeIt.group(id).then((g) => !stale && (setGroup(g), setName(g.name), setGranted(g.permissions)), (e: Error) => !stale && setMessage(e.message))
    return () => { stale = true }
  }, [id])

  // Keys Snipe-IT knows beyond the app's list still show, under Other.
  const known = new Set(PERMISSIONS.flatMap(([, keys]) => keys))
  const areas: [string, string[]][] = [...PERMISSIONS, ['Other', Object.keys(granted).filter((k) => !known.has(k))]]

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      // Every key shown goes back, granted or not, so unticking one takes it away.
      const permissions = Object.fromEntries(areas.flatMap(([, keys]) => keys).map((k) => [k, granted[k] === '1' ? '1' : '0']))
      const result = await window.snipeIt.saveGroup(id, name, permissions)
      if (result.ok) return onDone({ id, name })
      setErrors(result.errors)
      setMessage(result.message)
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save}>
      <header className="head">
        <h1>{group?.name ?? 'Permission group'}<span className="sub">Permission group</span></h1>
        <div className="actions">
          <button type="button" className="quiet" onClick={() => onDone(null)}>Back</button>
          <button disabled={busy || !group}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </header>
      {message && <p className="message error" role="alert">{message}</p>}
      {group && (
        <>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="group-name">Name</label>
              <input id="group-name" value={name} required onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name || undefined} />
              {errors.name && <p className="field-error">{errors.name}</p>}
            </div>
          </div>
          {errors.permissions && <p className="field-error access-body">{errors.permissions}</p>}
          <div className="permission-areas">
            {areas.filter(([, keys]) => keys.length).map(([area, keys]) => (
              <fieldset key={area}>
                <legend>{area}</legend>
                {keys.map((k) => (
                  <label key={k}>
                    <input type="checkbox" checked={granted[k] === '1'} onChange={(e) => setGranted((g) => ({ ...g, [k]: e.target.checked ? '1' : '0' }))} />
                    {permissionLabel(k, keys)}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </>
      )}
    </form>
  )
}
