import { useEffect, useState } from 'react'
import { PERMISSIONS, type Group, type GroupSummary, type StatusLabel, type UserAccess } from '../../main/snipeit'

/** Whether the Operator's account may manage permissions: null until Snipe-IT says; error when it couldn't be asked. */
export type CanManage = boolean | null | { error: string }
// Said wherever permissions could be managed but the Operator's account can't.
export const CANT_MANAGE = "Managing permissions needs a Snipe-IT superuser account. Yours isn't one, so groups and their permissions can't be changed from here; ask a Snipe-IT superuser."

// What the check's answer means on screen: nothing yet, the superuser notice, or why it couldn't be checked.
function AccessNotice({ canManage }: { canManage: CanManage }) {
  if (canManage === false) return <p className="notice" role="status">{CANT_MANAGE}</p>
  if (canManage && typeof canManage === 'object') return <p className="message error" role="alert">Couldn't check whether your account can manage permissions: {canManage.error}</p>
  return null
}

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
  // Whether this User is the Operator, whose removal from a group asks first: it may be where their superuser comes from.
  const [isMe, setIsMe] = useState(false)
  const [asking, setAsking] = useState<StatusLabel | null>(null)

  useEffect(() => {
    let stale = false
    window.snipeIt.userAccess(userId).then((a) => !stale && setAccess(a), (e: Error) => !stale && setError(e.message))
    if (canManage) {
      window.snipeIt.groups().then((g) => !stale && setAll(g), (e: Error) => !stale && setError(e.message))
      window.snipeIt.operatorAccess().then((me) => !stale && setIsMe(me.id === userId), () => !stale && setIsMe(true))
    }
    return () => { stale = true }
  }, [userId, canManage])

  async function change(groups: StatusLabel[]) {
    setAsking(null)
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
              <span key={g.id} className="flag c-blue">
                {g.name}
                {canManage && <button className="chip-x" disabled={busy} onClick={() => (isMe ? setAsking(g) : change(access.groups.filter((x) => x.id !== g.id)))} aria-label={`Remove from ${g.name}`}>×</button>}
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
          {asking && (
            <span className="confirm" role="alertdialog" aria-label={`Remove yourself from ${asking.name}?`}>
              <span>Remove yourself from {asking.name}? If your superuser comes from it, you can't manage groups from here any more.</span>
              <button className="danger" autoFocus disabled={busy} onClick={() => change(access.groups.filter((x) => x.id !== asking.id))}>Remove</button>
              <button className="quiet" disabled={busy} onClick={() => setAsking(null)}>Cancel</button>
            </span>
          )}
          <div className="k">Permissions of their own</div>
          <p className="dim">What each group grants is under All records → Permission groups.</p>
          {own.length === 0
            ? <p className="dim">None; everything they may do comes from their groups.</p>
            : <ul className="permissions">{own.map(([k, v]) => <li key={k}><span className={`chip ${v === '1' ? 'c-green' : 'c-red'}`}>{v === '1' ? 'Granted' : 'Denied'}</span> <span>{k}</span></li>)}</ul>}
        </div>
      )}
    </section>
  )
}

// Every permission group, and one group to make, edit or delete (Snipe-IT lets only a superuser do any of it).
export function GroupsView({ canManage: check }: { canManage: CanManage }) {
  const canManage = check === true
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [open, setOpen] = useState<number | 'new' | null>(null)
  const [error, setError] = useState('')
  // Read again on coming back from a group, so a new, renamed or deleted one shows.
  useEffect(() => {
    if (!canManage || open !== null) return
    let stale = false
    window.snipeIt.groups().then((g) => !stale && setGroups(g), (e: Error) => !stale && setError(e.message))
    return () => { stale = true }
  }, [canManage, open])

  if (open !== null) return <GroupEditor key={open} id={open === 'new' ? null : open} onCreated={setOpen} onBack={() => setOpen(null)} />
  return (
    <>
      <header className="head">
        <h1>Permission groups</h1>
        {canManage && <div className="actions"><button onClick={() => setOpen('new')}>New group</button></div>}
      </header>
      {check === null && <p className="empty">Checking your account…</p>}
      <AccessNotice canManage={check} />
      {error && <p className="message error" role="alert">{error}</p>}
      {groups && (
        <div className="records">
          {groups.map((g) => (
            <button key={g.id} className="record-kind" onClick={() => setOpen(g.id)}>
              {g.name}<span className="dim" aria-label={`${g.members} Users`}>{g.members}</span>
            </button>
          ))}
          {groups.length === 0 && <p className="empty">No groups</p>}
        </div>
      )}
    </>
  )
}

const ELEVATED = ['superuser', 'admin']
const NEW_GROUP: Group = { id: 0, name: '', members: 0, permissions: {} }

// id null: a new group, every permission unticked; once saved it stays open as that group.
function GroupEditor({ id, onCreated, onBack }: { id: number | null; onCreated: (id: number) => void; onBack: () => void }) {
  const [group, setGroup] = useState<Group | null>(id === null ? NEW_GROUP : null)
  const [name, setName] = useState('')
  const [granted, setGranted] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // Whether the Operator is in this group; null when it couldn't be checked, which counts as maybe.
  const [mine, setMine] = useState<boolean | null>(false)
  // Why the save or delete waits on a confirm: the lines it shows.
  const [asking, setAsking] = useState<{ save: true; why: string[] } | { save: false } | null>(null)
  useEffect(() => {
    if (id === null) return
    let stale = false
    window.snipeIt.group(id).then((g) => !stale && (setGroup(g), setName(g.name), setGranted(g.permissions)), (e: Error) => !stale && setMessage(e.message))
    window.snipeIt.operatorAccess().then((me) => !stale && setMine(me.groups.some((g) => g.id === id)), () => !stale && setMine(null))
    return () => { stale = true }
  }, [id])

  // Keys Snipe-IT knows beyond the app's list still show, under Other.
  const known = new Set(PERMISSIONS.flatMap(([, keys]) => keys))
  const areas: [string, string[]][] = [...PERMISSIONS, ['Other', Object.keys(granted).filter((k) => !known.has(k))]]

  // A change that could lock someone out asks first: superuser or admin changing, or a group the Operator is (maybe) in.
  function risks(g: Group): string[] {
    const changed = ELEVATED.filter((k) => (g.permissions[k] === '1') !== (granted[k] === '1'))
    const people = id === null ? '' : ` (${g.members === 1 ? '1 User' : `${g.members} Users`})`
    return [
      ...changed.map((k) => `This ${granted[k] === '1' ? 'grants' : 'takes away'} ${k} for everyone in the group${people}.`),
      ...(mine === true ? ["You're in this group, so this changes what your own account may do. If it takes away your superuser, you can't manage groups from here any more."] : []),
      ...(mine === null && id !== null ? ["Couldn't check whether you're in this group, so this may change what your own account may do."] : []),
    ]
  }

  async function save(e?: React.FormEvent, confirmed = false) {
    e?.preventDefault()
    if (!group) return
    const why = risks(group)
    if (why.length && !confirmed) return setAsking({ save: true, why })
    setAsking(null)
    setBusy(true)
    setMessage('')
    try {
      // Every key shown goes back, granted or not, so unticking one takes it away (and a new group isn't granted everything).
      const permissions = Object.fromEntries(areas.flatMap(([, keys]) => keys).map((k) => [k, granted[k] === '1' ? '1' : '0']))
      const result = await window.snipeIt.saveGroup(id, name, permissions)
      if (result.ok) return id === null ? onCreated(result.id) : onBack()
      setErrors(result.errors)
      setMessage(result.message)
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setMessage('')
    try {
      await window.snipeIt.deleteGroup(id!)
      onBack()
    } catch (err) {
      setMessage((err as Error).message)
      setBusy(false)
    }
  }

  const title = id === null ? 'New group' : group?.name
  return (
    <form onSubmit={save}>
      <header className="head">
        <h1><span className="dim">Permission groups{title && ' / '}</span>{title}</h1>
        <div className="actions">
          {asking?.save === true && (
            <span className="confirm" role="alertdialog" aria-label="Save this group?">
              <span>{asking.why.join(' ')} Save anyway?</span>
              <button type="button" className="danger" autoFocus disabled={busy} onClick={() => save(undefined, true)}>Save anyway</button>
              <button type="button" className="quiet" disabled={busy} onClick={() => setAsking(null)}>Cancel</button>
            </span>
          )}
          {/* Snipe-IT (v8.4.1+) deletes only a group with nobody in it, so one with Users says so instead of asking. */}
          {asking?.save === false && group && (
            group.members > 0 ? (
              <span className="confirm" role="alert">
                <span>Snipe-IT deletes only an empty group, and {group.members === 1 ? '1 User is' : `${group.members} Users are`} in {group.name}. Remove them first.</span>
                <button type="button" className="quiet" autoFocus onClick={() => setAsking(null)}>OK</button>
              </span>
            ) : (
              <span className="confirm" role="alertdialog" aria-label={`Delete ${group.name}?`}>
                <span>Delete {group.name}? This can't be undone.</span>
                <button type="button" className="danger" autoFocus disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</button>
                <button type="button" className="quiet" disabled={busy} onClick={() => setAsking(null)}>Cancel</button>
              </span>
            )
          )}
          {!asking && (
            <>
              <button type="button" className="quiet" onClick={onBack}>Back</button>
              {id !== null && <button type="button" className="quiet danger" disabled={busy || !group} onClick={() => setAsking({ save: false })}>Delete…</button>}
              <button disabled={busy || !group}>{busy ? 'Saving…' : 'Save'}</button>
            </>
          )}
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
