import { useEffect, useRef, useState } from 'react'
import { BULK_FORMS, filled, type Asset, type BulkKind, type EditKind, type FormField, type NamesKind, type SnipeItBridge, type StatusLabel } from '../../main/snipeit'
import { listName, singular } from './ListView'
import { NOT_ALLOWED, checkoutReason } from './App'

// Creates (id null) or edits one record. Snipe-IT checks it; its reasons show beside the field they're about.
// An edit sends only what the Operator changed: Snipe-IT sends some fields back reworded (notes rendered from Markdown,
// costs with separators), and saving them unchanged would rewrite them.
export function RecordForm({ kind, id, onSaved, onCancel }: { kind: EditKind; id: number | null; onSaved: (id: number) => void; onCancel: () => void }) {
  const [fields, setFields] = useState<FormField[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [initial, setInitial] = useState<Record<string, string>>({})
  // Bumped per Asset Model chosen; custom fields that arrive for an earlier choice are dropped. Save waits for them,
  // and stays off if they couldn't load, so an Asset isn't saved without the custom fields its model asks for.
  const modelChoice = useRef(0)
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [fieldsFailed, setFieldsFailed] = useState(false)
  const [names, setNames] = useState<Names>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  // A new User's Assets, checked out to them once they're created. created: the User is saved, but some of its Assets
  // weren't checked out; Save then retries just those, so the User is never created twice.
  const [toCheckOut, setToCheckOut] = useState<Pending[]>([])
  const [created, setCreated] = useState<number | null>(null)

  useEffect(() => {
    let stale = false
    window.snipeIt.form(kind, id ?? undefined).then((f) => {
      if (stale) return
      setFields(f.fields)
      setValues(f.values)
      setInitial(f.values)
      setLoaded(true)
      loadNames(f.fields, (n, v) => !stale && setNames((all) => ({ ...all, [n]: v })))
    }, (e: Error) => !stale && setMessage(e.message))
    return () => { stale = true }
  }, [kind, id])

  // An Asset's custom fields are its Asset Model's, so choosing another Asset Model swaps them.
  function set(key: string, value: string) {
    setValues((v) => withValue(fields, v, key, value))
    const cleared = new Set([key, ...fields.filter((f) => f.when === key).map((f) => f.key)])
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !cleared.has(k))))
    if (kind !== 'assets' || key !== 'model_id') return
    const own = (f: FormField) => !f.key.startsWith('_snipeit_')
    const mine = ++modelChoice.current
    // The old Asset Model's custom fields go at once, so they can't be saved with the new one.
    setFields((all) => all.filter(own))
    setFieldsFailed(false)
    if (!value) return setFieldsLoading(false)
    setFieldsLoading(true)
    window.snipeIt.customFields(Number(value)).then(
      (custom) => mine === modelChoice.current && (setFields((all) => [...all.filter(own), ...custom]), setFieldsLoading(false)),
      (e: Error) => mine === modelChoice.current && (setMessage(`Couldn't load this Asset Model's custom fields: ${e.message}`), setFieldsLoading(false), setFieldsFailed(true)))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // Enter in a field submits too; not while the Asset Model's custom fields are missing.
    if (fieldsLoading || fieldsFailed) return
    setBusy(true)
    setMessage('')
    try {
      let saved = created
      if (saved === null) {
        // Only what the form shows now goes to Snipe-IT (not a previous Asset Model's custom fields), and editing, only what changed.
        const shown = fields.map((f): [string, string] => [f.key, values[f.key] ?? ''])
        const result = await window.snipeIt.save(kind, id, Object.fromEntries(id === null ? shown : shown.filter(([k, v]) => v !== (initial[k] ?? ''))))
        if (!result.ok) return (setErrors(result.errors), setMessage(result.message))
        saved = result.id
      }
      const refused = await checkOutTo(saved, toCheckOut.map((p) => p.asset))
      if (!refused.length) return onSaved(saved)
      setCreated(saved)
      setToCheckOut(refused)
      setMessage(`The User is created, but ${refused.length === 1 ? "1 Asset wasn't" : `${refused.length} Assets weren't`} checked out to them: see below. Retry, or open the User.`)
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="record-form" onSubmit={submit} noValidate>
      <header className="head">
        <h1>{created !== null ? 'User created' : id === null ? `New ${singular(kind)}` : `Edit ${singular(kind)}`}</h1>
        <div className="actions">
          {created !== null
            ? <button type="button" className="quiet" disabled={busy} onClick={() => onSaved(created)}>Open User</button>
            : <button type="button" className="quiet" onClick={onCancel}>Cancel</button>}
          {fieldsFailed
            ? <button type="button" onClick={() => set('model_id', values.model_id ?? '')}>Retry custom fields</button>
            : <button disabled={busy || !loaded || fieldsLoading || (created !== null && !toCheckOut.length)}>
              {busy ? (created !== null ? 'Checking out…' : 'Saving…') : fieldsLoading ? 'Loading fields…' : created !== null ? 'Retry checkout'
                : toCheckOut.length ? `Save and check out ${toCheckOut.length === 1 ? '1 Asset' : `${toCheckOut.length} Assets`}` : 'Save'}
            </button>}
        </div>
      </header>
      {message && <p className="message error" role="alert">{message}</p>}
      {/* Once the User is created, only its Assets are left to do; editing it is Edit's job. */}
      {created === null && <div className="form-grid">
        {fields.map((f) => {
          const off = isOff(f, values)
          return (
            <div key={f.key} className={`form-field${f.type === 'textarea' ? ' wide' : ''}`}>
              <label htmlFor={`f-${f.key}`}>{f.label}{f.required && !off && <span className="dim"> (required)</span>}</label>
              <FieldInput field={off ? { ...f, required: false } : f} value={values[f.key] ?? ''} error={errors[f.key]} names={names} disabled={off} onChange={(v) => set(f.key, v)} />
              {errors[f.key] && <p id={`e-${f.key}`} className="field-error">{errors[f.key]}</p>}
            </div>
          )
        })}
      </div>}
      {kind === 'users' && id === null && <AssetsToCheckOut assets={toCheckOut} setAssets={setToCheckOut} busy={busy} />}
    </form>
  )
}

/** An Asset to check out to a new User; error: why the last try didn't. */
type Pending = { asset: Asset; error?: string }

/** Checks each Asset out to the User in turn; returns the ones that didn't go, each with the reason. */
export async function checkOutTo(userId: number, assets: Asset[], checkout: SnipeItBridge['checkout'] = (...a) => window.snipeIt.checkout(...a)): Promise<Pending[]> {
  const refused: Pending[] = []
  for (const asset of assets) await checkout(asset.id, { targetType: 'user', targetId: userId }).catch((e: Error) => refused.push({ asset, error: e.message }))
  return refused
}

// The New User form's Assets: scanned or typed by Asset Tag, Enter adds one. Only an Asset that can be checked out now is
// added; Snipe-IT still has the last word when the User is saved. busy: they're being checked out, so the list holds still.
function AssetsToCheckOut({ assets, setAssets, busy }: { assets: Pending[]; setAssets: React.Dispatch<React.SetStateAction<Pending[]>>; busy: boolean }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [looking, setLooking] = useState(false)
  async function add(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    // Enter here adds the Asset; it doesn't save the User.
    e.preventDefault()
    const tag = text.trim()
    if (!tag || looking) return
    setLooking(true)
    setError('')
    try {
      const a = await window.snipeIt.assetByTag(tag)
      const why = !a ? `No Asset has the Asset Tag ${tag}.` : assets.some((p) => p.asset.id === a.id) ? `${a.assetTag} is already listed.` : checkoutReason(a) && `${a.assetTag}: ${checkoutReason(a)}.`
      if (why) return setError(why)
      setAssets((all) => (all.some((p) => p.asset.id === a!.id) ? all : [...all, { asset: a! }]))
      // Whatever was scanned next while this one was looked up stays.
      setText((t) => (t.trim() === tag ? '' : t))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLooking(false)
    }
  }
  return (
    <div className="form-grid">
      <div className="form-field wide">
        <label htmlFor="f-assets">Assets to check out to this User</label>
        <input id="f-assets" value={text} disabled={busy} onChange={(e) => (setText(e.target.value), setError(''))} onKeyDown={add} autoComplete="off"
          placeholder="Scan or type an Asset Tag, then Enter" aria-invalid={!!error || undefined} aria-describedby={error ? 'e-assets' : undefined} />
        {error && <p id="e-assets" className="field-error" role="alert">{error}</p>}
        {assets.map(({ asset, error }) => (
          <div key={asset.id} className="actions">
            <b>{asset.assetTag}</b> <span className="dim">{asset.name || asset.model}</span>
            <button type="button" className="quiet" disabled={busy} onClick={() => setAssets((all) => all.filter((p) => p.asset.id !== asset.id))}>Remove</button>
            {error && <span className="field-error">{error}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A field whose checkbox (when) isn't checked: shown off, and blank, so nothing typed into it before is kept. */
export const isOff = (f: FormField, values: Record<string, string>) => !!f.when && values[f.when] !== '1'
/** The values with key set; a checkbox turned off blanks the fields that need it (a new User's password when login goes off). */
export const withValue = (fields: FormField[], values: Record<string, string>, key: string, value: string) => ({
  ...values, [key]: value, ...(value !== '1' && Object.fromEntries(fields.filter((f) => f.when === key).map((f) => [f.key, '']))),
})

type Names = Partial<Record<NamesKind, StatusLabel[]>>
// Loads the names each choice offers; a choice whose names don't load just offers what it has.
function loadNames(fields: FormField[], add: (n: NamesKind, names: StatusLabel[]) => void) {
  for (const n of new Set(fields.flatMap((f) => (f.choices ? [f.choices] : [])))) window.snipeIt.names(n).then((v) => add(n, v), () => {})
}

// One field's input. blank: what an empty choice says.
function FieldInput({ field: f, value, error, names, disabled, blank = f.required ? `Choose ${f.label.toLowerCase()}` : 'None', onChange }: {
  field: FormField; value: string; error?: string; names: Names; disabled?: boolean; blank?: string; onChange: (value: string) => void
}) {
  const common = { id: `f-${f.key}`, value, required: f.required, disabled, 'aria-invalid': !!error || undefined, 'aria-describedby': error ? `e-${f.key}` : undefined }
  if (f.type === 'checkbox') return <div className="choices"><input {...common} type="checkbox" value="1" checked={value === '1'} onChange={(e) => onChange(e.target.checked ? '1' : '')} /></div>
  if (f.type === 'textarea') return <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />
  if (f.type === 'choices') {
    const picked = value.split(',').map((v) => v.trim()).filter(Boolean)
    const toggle = (o: string) => onChange((picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o]).join(', '))
    return (
      <div className="choices" id={common.id} role="group" aria-describedby={common['aria-describedby']}>
        {f.options?.map((o) => <label key={o}><input type="checkbox" checked={picked.includes(o)} onChange={() => toggle(o)} /> {o}</label>)}
      </div>
    )
  }
  if (f.type === 'choice') {
    const options = f.options?.map((o) => ({ id: o, name: o })) ?? names[f.choices!] ?? []
    return (
      <select {...common} onChange={(e) => onChange(e.target.value)}>
        <option value="">{blank}</option>
        {/* The current value shows even before the names load. */}
        {value && !options.some((o) => String(o.id) === value) && <option value={value}>…</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    )
  }
  return <input {...common} type={f.type} step={f.type === 'number' ? 'any' : undefined} autoComplete={f.type === 'password' ? 'new-password' : 'off'} onChange={(e) => onChange(e.target.value)} />
}

// "Edit shared fields" for a Selection: it starts empty, and only what the Operator fills in is applied to each Record;
// a field left blank stays as each one has it.
// busy: another Bulk Action is still running, so this one waits.
export function BulkEditForm({ kind, count, busy, onApply, onCancel }: { kind: BulkKind; count: number; busy: boolean; onApply: (values: Record<string, string>) => void; onCancel: () => void }) {
  const fields = BULK_FORMS[kind]
  const [values, setValues] = useState<Record<string, string>>({})
  const [names, setNames] = useState<Names>({})
  useEffect(() => {
    let stale = false
    loadNames(fields, (n, v) => !stale && setNames((all) => ({ ...all, [n]: v })))
    return () => { stale = true }
  }, [fields])
  const shared = filled(values)
  const anyFilled = Object.keys(shared).length > 0
  return (
    <form className="list-panel" aria-label="Edit shared fields" noValidate onSubmit={(e) => (e.preventDefault(), anyFilled && !busy && onApply(shared))}>
      <div className="actions">
        <b>Edit shared fields</b>
        <span className="dim">A field left blank stays as each {singular(kind)} has it.</span>
        <button disabled={!anyFilled || busy}>Apply to {count.toLocaleString()} {count === 1 ? singular(kind) : listName[kind]}</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
      <div className="form-grid bulk-form">
        {fields.map((f) => (
          <div key={f.key} className={`form-field${f.type === 'textarea' ? ' wide' : ''}`}>
            <label htmlFor={`f-${f.key}`}>{f.label}</label>
            <FieldInput field={f} value={values[f.key] ?? ''} names={names} blank="Leave as is" onChange={(v) => setValues((all) => ({ ...all, [f.key]: v }))} />
          </div>
        ))}
      </div>
    </form>
  )
}

// Asks before deleting; Snipe-IT's refusal (e.g. an Asset still checked out) shows in place.
export function DeleteButton({ kind, id, name, onDeleted, allowed = true }: { kind: EditKind; id: number; name: string; onDeleted: () => void; allowed?: boolean }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function remove() {
    setBusy(true)
    setError('')
    try {
      await window.snipeIt.remove(kind, id)
      onDeleted()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  if (!asking) return <button className="quiet danger" disabled={!allowed} title={allowed ? undefined : NOT_ALLOWED} onClick={() => setAsking(true)}>Delete…</button>
  return (
    <span className="confirm" role="alertdialog" aria-label={`Delete ${name}?`}>
      <span>Delete {name}? It goes to Snipe-IT's deleted items and leaves every List.</span>
      <button className="danger" autoFocus disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</button>
      <button className="quiet" disabled={busy} onClick={() => (setAsking(false), setError(''))}>Cancel</button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </span>
  )
}
