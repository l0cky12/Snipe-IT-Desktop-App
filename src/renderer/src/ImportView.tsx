import { useEffect, useRef, useState } from 'react'
import { IMPORT_FIELDS, IMPORT_TYPES, reason, type ImportFile, type ImportResult, type ImportType } from '../../main/snipeit'

// Heading → field for each column ('' not matched). A CSV imported before as this type keeps its matching; any other
// heading is matched to the field it names, by Snipe-IT's rule: its key or label, in any case, with _ for spaces.
export function matchColumns(headers: string[], type: ImportType, before?: Pick<ImportFile, 'type' | 'mapping'>): Record<string, string> {
  const fields = IMPORT_FIELDS[type]
  const norm = (s: string) => s.trim().replace(/_/g, ' ').toLowerCase()
  const kept = before?.type === type ? before.mapping : {}
  return Object.fromEntries(headers.map((h) => [h, fields.some(([key]) => key === kept[h]) ? kept[h]
    : fields.find(([key, label]) => norm(key) === norm(h) || norm(label) === norm(h))?.[0] ?? '']))
}

// The CSVs uploaded to Snipe-IT's importer, and the one being imported.
export function ImportView() {
  const [files, setFiles] = useState<ImportFile[] | null>(null)
  const [active, setActive] = useState<ImportFile | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const refresh = () => window.snipeIt.imports().then(setFiles, (e: Error) => setError(e.message))
  useEffect(() => { refresh() }, [])

  async function upload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const uploaded = await window.snipeIt.uploadImport(file.name, await file.text())
      setActive(uploaded)
      refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
      if (picker.current) picker.current.value = ''
    }
  }

  return (
    <>
      <header className="head">
        <h1>Import<span className="sub">Create or update Records from a CSV, through Snipe-IT's importer</span></h1>
        <div className="actions">
          <input ref={picker} type="file" accept=".csv,text/csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button disabled={uploading} onClick={() => picker.current?.click()}>{uploading ? 'Uploading…' : 'Upload CSV…'}</button>
        </div>
      </header>
      {error && <p className="message error" role="alert">{error}</p>}
      {active && <ImportForm key={active.id} file={active} onRan={refresh} onClose={() => setActive(null)} />}
      <div className="section">Uploaded CSVs</div>
      {files && files.length > 0 && (
        <table className="history list-table">
          <thead><tr><th>File</th><th>Uploaded</th><th>Size</th><th>Last imported as</th><th /></tr></thead>
          <tbody>{files.map((f) => (
            <tr key={f.id} className={f.id === active?.id ? 'sel' : undefined}>
              <td className="mono">{f.name}</td><td>{f.uploaded}</td><td>{f.size || '—'}</td><td>{f.type ? IMPORT_TYPES[f.type] : '—'}</td>
              <td><div className="actions">
                <button className="quiet" onClick={() => setActive(f)}>{f.type ? 'Import again…' : 'Import…'}</button>
                <DeleteUpload file={f} onDeleted={() => (active?.id === f.id && setActive(null), refresh())} onFailed={refresh} />
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {files?.length === 0 && <p className="empty">No CSVs uploaded yet</p>}
      {!files && !error && <p className="message list-message" role="status">Loading…</p>}
    </>
  )
}

// Matching each column to a field, choosing whether matching Records are updated or skipped, and running it.
function ImportForm({ file, onRan, onClose }: { file: ImportFile; onRan: () => void; onClose: () => void }) {
  const [type, setType] = useState<ImportType | ''>(file.type)
  const [mapping, setMapping] = useState(() => (file.type ? matchColumns(file.headers, file.type, file) : {}))
  const [update, setUpdate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  function choose(t: ImportType) {
    setType(t)
    setMapping(matchColumns(file.headers, t, file))
    setResult(null)
  }

  async function run(e: React.FormEvent) {
    e.preventDefault()
    if (!type) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await window.snipeIt.processImport(file.id, type, mapping, update))
      onRan()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const failed = result && !result.ok ? Object.entries(result.errors) : []
  return (
    <form className="import-form" onSubmit={run}>
      <div className="actions">
        <b className="mono">{file.name}</b>
        <select value={type} required disabled={busy} onChange={(e) => choose(e.target.value as ImportType)} aria-label="What it imports">
          <option value="" disabled>Choose what it imports…</option>
          {(Object.keys(IMPORT_TYPES) as ImportType[]).map((t) => <option key={t} value={t}>{IMPORT_TYPES[t]}</option>)}
        </select>
      </div>
      {type && (
        <>
          <table className="history list-table">
            <thead><tr><th>Column</th><th>First row</th><th>Field</th></tr></thead>
            <tbody>{file.headers.map((h, i) => (
              <tr key={i}>
                <td>{h || '—'}</td><td className="dim">{file.firstRow[i] || '—'}</td>
                <td><div className="actions">
                  <select value={mapping[h] ?? ''} disabled={busy} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))} aria-label={`Field for ${h}`}>
                    <option value="">Not matched</option>
                    {IMPORT_FIELDS[type].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="message">Snipe-IT still reads a column left Not matched if its heading is a field's name (like asset_tag).{type === 'asset' && " A column headed with a Custom Field's name fills that field."}</p>
          <fieldset className="plain actions" disabled={busy}>
            <span className="dim">Records that already exist:</span>
            <label className="choice"><input type="radio" name="update" checked={!update} onChange={() => setUpdate(false)} /> Skip them</label>
            <label className="choice"><input type="radio" name="update" checked={update} onChange={() => setUpdate(true)} /> Update them</label>
          </fieldset>
        </>
      )}
      <div className="actions">
        <button disabled={!type || busy}>{busy ? 'Importing… this can take a few minutes' : 'Import'}</button>
        <button type="button" className="quiet" disabled={busy} onClick={onClose}>Close</button>
      </div>
      {error && <p className="message error" role="alert">{error}</p>}
      {result?.ok && <p className="message list-message" role="status">Imported. Snipe-IT reported no failed rows.</p>}
      {failed.length > 0 && (
        <>
          <p className="message error" role="alert">{failed.length === 1 ? '1 row' : `${failed.length} rows`} failed. The other rows went through; nothing is rolled back.</p>
          <table className="history list-table import-errors">
            <thead><tr><th>Row</th><th>Snipe-IT's message</th></tr></thead>
            <tbody>{failed.map(([row, messages]) => <tr key={row}><td>{row}</td><td>{reason(messages)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </form>
  )
}

// Asks first: the CSV is deleted from Snipe-IT for good. On a failure the list reloads, as Snipe-IT may have dropped it anyway.
function DeleteUpload({ file, onDeleted, onFailed }: { file: ImportFile; onDeleted: () => void; onFailed: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function remove() {
    setBusy(true)
    setError('')
    try {
      await window.snipeIt.deleteImport(file.id)
      onDeleted()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
      onFailed()
    }
  }
  if (!asking) return <button className="quiet danger" onClick={() => setAsking(true)}>Delete…</button>
  return (
    <span className="confirm" role="alertdialog" aria-label={`Delete ${file.name}?`}>
      <span>Delete this CSV from Snipe-IT? Records it imported stay.</span>
      <button className="danger" autoFocus disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</button>
      <button className="quiet" disabled={busy} onClick={() => (setAsking(false), setError(''))}>Cancel</button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </span>
  )
}
