import { useEffect, useState } from 'react'
import { EDIT_KINDS, type EditKind, type Field, type ListKind, type RecordDetail, type RecordKind } from '../../main/snipeit'
import { drillLabel, singular, type Drill } from './ListView'
import { DeleteButton } from './RecordForm'

export const editable = (kind: ListKind): kind is EditKind => (EDIT_KINDS as readonly string[]).includes(kind)

// The Lists filtered to one record: a User's checked-out Assets, a Location's Assets and Users, and so on.
const RELATED: Partial<Record<RecordKind, [label: string, list: ListKind, filter: string][]>> = {
  users: [['Assets checked out', 'assets', 'user_id']],
  locations: [['Assets', 'assets', 'location_id'], ['Users', 'users', 'location_id']],
  models: [['Assets', 'assets', 'model_id']],
  // A Category's own kind of thing: see CATEGORY_LISTS.
  manufacturers: [['Assets', 'assets', 'manufacturer_id']],
  suppliers: [['Assets', 'assets', 'supplier_id']],
  companies: [['Assets', 'assets', 'company_id'], ['Users', 'users', 'company_id']],
  departments: [['Users', 'users', 'department_id']],
  statuslabels: [['Assets', 'assets', 'status_id']],
}

// What a Category holds, by its type.
const CATEGORY_LISTS: Record<string, [label: string, list: ListKind, filter: string][]> = {
  asset: [['Assets', 'assets', 'category_id'], ['Asset Models', 'models', 'category_id']],
  license: [['Licenses', 'licenses', 'category_id']], accessory: [['Accessories', 'accessories', 'category_id']],
  consumable: [['Consumables', 'consumables', 'category_id']], component: [['Components', 'components', 'category_id']],
}

// Every field of one record. A related record links to its own page; what belongs to it is a List away.
export function RecordView({ kind, id, onOpenRecord, onOpenAsset, onDrill, onEdit, onDeleted }: {
  onEdit: (kind: EditKind, id: number) => void
  onDeleted: (kind: EditKind, id: number, name: string) => void
  kind: RecordKind
  id: number
  onOpenRecord: (kind: RecordKind, id: number) => void
  onOpenAsset: (id: number) => void
  onDrill: (list: ListKind, drill: Drill) => void
}) {
  const [record, setRecord] = useState<RecordDetail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let stale = false
    setRecord(null)
    setError('')
    window.snipeIt.record(kind, id).then((r) => !stale && setRecord(r), (e: Error) => !stale && setError(e.message))
    return () => { stale = true }
  }, [kind, id])

  if (error) return <p className="message error" role="alert">{error}</p>
  if (!record) return <p className="empty">Loading…</p>
  return (
    <>
      <header className="head">
        <h1>
          {record.name || '—'}
          <span className="sub">{singular(kind)}</span>
        </h1>
        <div className="actions">
          {(kind === 'categories' ? CATEGORY_LISTS[record.categoryType ?? ''] ?? [] : RELATED[kind] ?? []).map(([label, list, filter]) => (
            <button key={label} className="quiet"
              onClick={() => onDrill(list, { filters: { [filter]: String(id) }, label: drillLabel(kind, record.name) })}>
              {label}
            </button>
          ))}
          {editable(kind) && (
            <>
              <button className="quiet" onClick={() => onEdit(kind, id)}>Edit</button>
              <DeleteButton kind={kind} id={id} name={record.name} onDeleted={() => onDeleted(kind, id, record.name)} />
            </>
          )}
        </div>
      </header>
      <FieldGrid fields={record.fields} onOpenRecord={onOpenRecord} onOpenAsset={onOpenAsset} />
      {record.fields.length === 0 && <p className="empty">No fields</p>}
    </>
  )
}

export function FieldGrid({ fields, onOpenRecord, onOpenAsset }: { fields: Field[]; onOpenRecord: (kind: RecordKind, id: number) => void; onOpenAsset: (id: number) => void }) {
  return (
    <div className="grid">
      {fields.map((f, i) => {
        const link = f.link
        return (
          <div className="cell" key={i}>
            <div className="k">{f.label}</div>
            {link
              ? <button className="link" onClick={() => (link.kind === 'assets' ? onOpenAsset(link.id) : onOpenRecord(link.kind, link.id))}>{f.value}</button>
              : <span>{f.value}</span>}
          </div>
        )
      })}
    </div>
  )
}
