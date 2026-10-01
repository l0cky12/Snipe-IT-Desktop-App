import { useEffect, useRef, useState } from 'react'
import type { EditKind, FormField, NamesKind, StatusLabel } from '../../main/snipeit'
import { singular } from './ListView'

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
  const [names, setNames] = useState<Partial<Record<NamesKind, StatusLabel[]>>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stale = false
    window.snipeIt.form(kind, id ?? undefined).then((f) => {
      if (stale) return
      setFields(f.fields)
      setValues(f.values)
      setInitial(f.values)
      setLoaded(true)
      // A choice whose names don't load just offers what it has.
      for (const n of new Set(f.fields.flatMap((x) => (x.choices ? [x.choices] : []))))
        window.snipeIt.names(n).then((v) => !stale && setNames((all) => ({ ...all, [n]: v })), () => {})
    }, (e: Error) => !stale && setMessage(e.message))
    return () => { stale = true }
  }, [kind, id])

  // An Asset's custom fields are its Asset Model's, so choosing another Asset Model swaps them.
  function set(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors(({ [key]: _, ...rest }) => rest)
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
      // Only what the form shows now goes to Snipe-IT (not a previous Asset Model's custom fields), and editing, only what changed.
      const shown = fields.map((f): [string, string] => [f.key, values[f.key] ?? ''])
      const result = await window.snipeIt.save(kind, id, Object.fromEntries(id === null ? shown : shown.filter(([k, v]) => v !== (initial[k] ?? ''))))
      if (result.ok) return onSaved(result.id)
      setErrors(result.errors)
      setMessage(result.message)
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const input = (f: FormField) => {
    const common = { id: `f-${f.key}`, value: values[f.key] ?? '', required: f.required, 'aria-invalid': !!errors[f.key] || undefined, 'aria-describedby': errors[f.key] ? `e-${f.key}` : undefined }
    if (f.type === 'textarea') return <textarea {...common} rows={3} onChange={(e) => set(f.key, e.target.value)} />
    if (f.type === 'choices') {
      const picked = common.value.split(',').map((v) => v.trim()).filter(Boolean)
      const toggle = (o: string) => set(f.key, (picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o]).join(', '))
      return (
        <div className="choices" id={common.id} role="group" aria-describedby={common['aria-describedby']}>
          {f.options?.map((o) => <label key={o}><input type="checkbox" checked={picked.includes(o)} onChange={() => toggle(o)} /> {o}</label>)}
        </div>
      )
    }
    if (f.type === 'choice') {
      const options = f.options?.map((o) => ({ id: o, name: o })) ?? names[f.choices!] ?? []
      return (
        <select {...common} onChange={(e) => set(f.key, e.target.value)}>
          <option value="">{f.required ? `Choose ${f.label.toLowerCase()}` : 'None'}</option>
          {/* The current value shows even before the names load. */}
          {common.value && !options.some((o) => String(o.id) === common.value) && <option value={common.value}>…</option>}
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )
    }
    return <input {...common} type={f.type} step={f.type === 'number' ? 'any' : undefined} autoComplete={f.type === 'password' ? 'new-password' : 'off'} onChange={(e) => set(f.key, e.target.value)} />
  }

  return (
    <form className="record-form" onSubmit={submit} noValidate>
      <header className="head">
        <h1>{id === null ? `New ${singular(kind)}` : `Edit ${singular(kind)}`}</h1>
        <div className="actions">
          <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
          {fieldsFailed
            ? <button type="button" onClick={() => set('model_id', values.model_id ?? '')}>Retry custom fields</button>
            : <button disabled={busy || !loaded || fieldsLoading}>{busy ? 'Saving…' : fieldsLoading ? 'Loading fields…' : 'Save'}</button>}
        </div>
      </header>
      {message && <p className="message error" role="alert">{message}</p>}
      <div className="form-grid">
        {fields.map((f) => (
          <div key={f.key} className={`form-field${f.type === 'textarea' ? ' wide' : ''}`}>
            <label htmlFor={`f-${f.key}`}>{f.label}{f.required && <span className="dim"> (required)</span>}</label>
            {input(f)}
            {errors[f.key] && <p id={`e-${f.key}`} className="field-error">{errors[f.key]}</p>}
          </div>
        ))}
      </div>
    </form>
  )
}

// Asks before deleting; Snipe-IT's refusal (e.g. an Asset still checked out) shows in place.
export function DeleteButton({ kind, id, name, onDeleted }: { kind: EditKind; id: number; name: string; onDeleted: () => void }) {
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
  if (!asking) return <button className="quiet danger" onClick={() => setAsking(true)}>Delete…</button>
  return (
    <span className="confirm" role="alertdialog" aria-label={`Delete ${name}?`}>
      <span>Delete {name}? It goes to Snipe-IT's deleted items and leaves every List.</span>
      <button className="danger" autoFocus disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</button>
      <button className="quiet" disabled={busy} onClick={() => (setAsking(false), setError(''))}>Cancel</button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </span>
  )
}
