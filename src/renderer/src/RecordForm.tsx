import { useEffect, useRef, useState } from 'react'
import { BULK_FORMS, filled, type Asset, type BulkKind, type EditKind, type FormField, type NamesKind, type SnipeItBridge, type StatusLabel } from '../../main/snipeit'
import { choices, filterPick, listName, singular, toOptions } from './ListView'
import { NOT_ALLOWED, checkoutReason } from './App'
import { cleanTag } from './workflows'

// Creates (id null) or edits one record. Snipe-IT checks it; its reasons show beside the field they're about.
// An edit sends only what the Operator changed: Snipe-IT sends some fields back reworded (notes rendered from Markdown,
// costs with separators), and saving them unchanged would rewrite them.
// onUnfinished: what's left undone when the Operator leaves the form while it's still sending (the rail shows it).
export function RecordForm({ kind, id, onSaved, onCancel, onUnfinished }: {
  kind: EditKind; id: number | null; onSaved: (id: number) => void; onCancel: () => void; onUnfinished: (text: string) => void
}) {
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
  // Asset lookups not back yet: Save waits, so a scanned Asset isn't left out of the Checkout.
  const [lookups, setLookups] = useState(0)
  // The form is closed (another page, Settings): no more Checkouts are sent, so none can reach a server changed since.
  const gone = useRef(false)
  useEffect(() => {
    gone.current = false
    return () => { gone.current = true }
  }, [])

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
    // Enter in a field submits too; not while the Asset Model's custom fields are missing, or Assets are still being looked up.
    if (fieldsLoading || fieldsFailed || lookups) return
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
      const refused = await checkOutTo(saved, toCheckOut.map((p) => p.asset), (...a) => window.snipeIt.checkout(...a), () => gone.current)
      // Left while sending: the Operator is elsewhere now, so they aren't taken to the User; what didn't go shows in the rail.
      if (!refused.length) return gone.current || onSaved(saved)
      const says = `The User is created, but ${refused.length === 1 ? "1 Asset wasn't" : `${refused.length} Assets weren't`} checked out to them`
      if (gone.current) return onUnfinished(`${says}: ${refused.map((p) => `${p.asset.assetTag} (${p.error})`).join(', ')}.`)
      setCreated(saved)
      setToCheckOut(refused)
      setMessage(`${says}: see below. Retry, or open the User.`)
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const head = headButtons({ busy, loaded, fieldsLoading, lookups, created, toCheckOut: toCheckOut.length })
  return (
    <form className="record-form" onSubmit={submit} noValidate>
      <header className="head">
        <h1>{created !== null ? 'User created' : id === null ? `New ${singular(kind)}` : `Edit ${singular(kind)}`}</h1>
        <div className="actions">
          <button type="button" className="quiet" disabled={head.cancel.disabled} onClick={() => (created !== null ? onSaved(created) : onCancel())}>{head.cancel.label}</button>
          {fieldsFailed
            ? <button type="button" onClick={() => set('model_id', values.model_id ?? '')}>Retry custom fields</button>
            : <button disabled={head.save.disabled}>{head.save.label}</button>}
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
      {kind === 'users' && id === null && <AssetsToCheckOut assets={toCheckOut} setAssets={setToCheckOut} busy={busy} pending={(by) => setLookups((n) => n + by)} />}
    </form>
  )
}

/**
 * The form's header buttons: Cancel (Open User once the User is created) and Save, with what each says. Both wait while
 * saving: the User and its Checkouts are already on their way to Snipe-IT, and a Cancel can't take them back. Save also
 * waits for Asset lookups still out (lookups), so a scanned Asset isn't left out. toCheckOut: how many Assets are listed.
 */
export function headButtons({ busy, loaded, fieldsLoading, lookups, created, toCheckOut }: {
  busy: boolean; loaded: boolean; fieldsLoading: boolean; lookups: number; created: number | null; toCheckOut: number
}) {
  const assets = toCheckOut === 1 ? '1 Asset' : `${toCheckOut} Assets`
  return {
    cancel: { label: created !== null ? 'Open User' : 'Cancel', disabled: busy },
    save: {
      disabled: busy || !loaded || fieldsLoading || lookups > 0 || (created !== null && !toCheckOut),
      label: busy ? (created !== null ? 'Checking out…' : 'Saving…') : fieldsLoading ? 'Loading fields…' : lookups ? 'Looking up Assets…'
        : created !== null ? 'Retry checkout' : toCheckOut ? `Save and check out ${assets}` : 'Save',
    },
  }
}

/** An Asset to check out to a new User; error: why the last try didn't. */
type Pending = { asset: Asset; error?: string }

/** Why an Asset wasn't checked out: the form was closed before its turn. */
export const LEFT_FIRST = 'not sent: the form was closed first'
/** Checks each Asset out to the User in turn, until stopped; returns the ones that didn't go, each with the reason. */
export async function checkOutTo(userId: number, assets: Asset[], checkout: SnipeItBridge['checkout'], stopped: () => boolean = () => false): Promise<Pending[]> {
  const refused: Pending[] = []
  for (const asset of assets) {
    if (stopped()) refused.push({ asset, error: LEFT_FIRST })
    else await checkout(asset.id, { targetType: 'user', targetId: userId }).catch((e: Error) => refused.push({ asset, error: e.message }))
  }
  return refused
}

/**
 * One scanned or typed Asset Tag, looked up on its own, so scans that come faster than Snipe-IT answers are neither merged
 * nor dropped. pending counts lookups not back yet (Save waits for them). Only an Asset that can be checked out now is added;
 * Snipe-IT still has the last word when the User is saved.
 */
export async function scanAsset(raw: string, { lookup, listed, add, refuse, pending }: {
  lookup: (tag: string) => Promise<Asset | null>; listed: () => Pending[]
  add: (tag: string, asset: Asset) => void; refuse: (tag: string, why: string) => void; pending: (by: 1 | -1) => void
}) {
  const tag = cleanTag(raw)
  if (!tag) return
  pending(1)
  try {
    const a = await lookup(tag)
    if (!a) refuse(tag, `No Asset has the Asset Tag ${tag}.`)
    else if (listed().some((p) => p.asset.id === a.id)) refuse(tag, `${a.assetTag} is already listed.`)
    else if (checkoutReason(a)) refuse(tag, `${a.assetTag}: ${checkoutReason(a)}.`)
    else add(tag, a)
  } catch (e) {
    refuse(tag, `${tag}: ${(e as Error).message}`)
  } finally {
    pending(-1)
  }
}

// The New User form's Assets, added by Asset Tag (Enter adds one). A refusal stays until that tag is added, so the next
// scan doesn't wipe it. busy: they're being checked out, so the list holds still.
function AssetsToCheckOut({ assets, setAssets, busy, pending }: {
  assets: Pending[]; setAssets: React.Dispatch<React.SetStateAction<Pending[]>>; busy: boolean; pending: (by: 1 | -1) => void
}) {
  const [text, setText] = useState('')
  const [refused, setRefused] = useState<Record<string, string>>({})
  const listed = useRef(assets)
  listed.current = assets
  const unrefuse = (tag: string) => setRefused(({ [tag.toUpperCase()]: _, ...rest }) => rest)
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    // Enter here adds the Asset; it doesn't save the User. The tag is taken at once, so the field is clear for the next scan.
    e.preventDefault()
    const raw = e.currentTarget.value
    setText('')
    scanAsset(raw, {
      lookup: (tag) => window.snipeIt.assetByTag(tag), listed: () => listed.current, pending,
      add: (tag, asset) => (setAssets((all) => (all.some((p) => p.asset.id === asset.id) ? all : [...all, { asset }])), unrefuse(tag)),
      refuse: (tag, why) => setRefused((r) => ({ ...r, [tag.toUpperCase()]: why })),
    })
  }
  const refusals = Object.values(refused)
  return (
    <div className="form-grid">
      <div className="form-field wide">
        <label htmlFor="f-assets">Assets to check out to this User</label>
        <input id="f-assets" value={text} disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} autoComplete="off"
          placeholder="Scan or type an Asset Tag, then Enter" aria-describedby={refusals.length ? 'e-assets' : undefined} />
        {refusals.length > 0 && <div id="e-assets" role="alert">{refusals.map((why) => <p key={why} className="field-error">{why}</p>)}</div>}
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
  if (f.type === 'choice' && f.choices) return <NameBox common={common} label={f.label} names={names[f.choices] ?? []} blank={blank} offerBlank={!f.required} onChange={onChange} />
  if (f.type === 'choice') {
    const options = f.options?.map((o) => ({ id: o, name: o })) ?? []
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

// A name box's choices, and what typing `text` picks: an id, '' to clear, or null while it names no choice yet.
// matches: some choice still has the text in its name, ignoring case.
export function namePick(names: StatusLabel[], blank: string, text: string) {
  const f = { label: blank, options: toOptions(names) }
  const options = choices(f)
  const t = text.trim().toLowerCase()
  return { options, picked: filterPick(f, text, options), matches: !t || options.some((o) => o.label.toLowerCase().includes(t)) }
}

// Snipe-IT's names (Asset Models, Status Labels, Locations…) can run long, so like the List filters they're a box to type in,
// with the browser's datalist to scroll or narrow. Focusing empties it to show every choice; only a whole name picks, and its
// id is what's saved. Text that names no choice is put back on leaving the box.
function NameBox({ common, label, names, blank, offerBlank, onChange }: {
  common: { id: string; value: string; required?: boolean; disabled?: boolean; 'aria-invalid'?: boolean; 'aria-describedby'?: string }
  label: string; names: StatusLabel[]; blank: string; offerBlank: boolean; onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const { options } = namePick(names, blank, '')
  // The current value shows even before the names load.
  const shown = options.find((o) => o.value === common.value)?.label ?? (common.value ? '…' : '')
  const none = draft !== null && !namePick(names, blank, draft).matches
  function change(t: string) {
    const { picked } = namePick(names, blank, t)
    setDraft(picked === null ? t : null)
    if (picked !== null && picked !== common.value) onChange(picked)
  }
  const hint = `${common.id}-none`
  return (
    <>
      <input {...common} value={draft ?? shown} list={`${common.id}-names`} placeholder={shown || blank} autoComplete="off"
        aria-describedby={[common['aria-describedby'], none && hint].filter(Boolean).join(' ') || undefined}
        onFocus={() => setDraft('')} onBlur={() => setDraft(null)} onKeyDown={(e) => e.key === 'Escape' && setDraft('')} onChange={(e) => change(e.target.value)} />
      <datalist id={`${common.id}-names`}>
        {offerBlank && <option value={blank} />}
        {options.map((o) => <option key={o.value} value={o.label} />)}
      </datalist>
      {none && <p id={hint} className="dim" role="status">No {label} matches “{draft!.trim()}”.</p>}
    </>
  )
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
