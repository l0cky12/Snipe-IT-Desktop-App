import { Fragment, useEffect, useState } from 'react'
import { EDIT_KINDS, type EditKind, type Field, type ListKind, type RecordDetail, type RecordKind, type StockKind } from '../../main/snipeit'
import { drillLabel, listName, type Drill } from './ListView'
import { DeleteButton } from './RecordForm'
import { UserAccessSection, type CanManage } from './AccessView'
import { CheckoutForm, NOT_ALLOWED } from './App'
import { HoldersSection, UserHeldSection } from './StockView'

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
export function RecordView({ kind, id, onOpenRecord, onOpenAsset, onDrill, onEdit, onDeleted, canManage }: {
  canManage: CanManage
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
  // Bumped by a Checkout or Checkin, so what's left and who holds it reload in place.
  const [version, setVersion] = useState(0)
  const [checkingOut, setCheckingOut] = useState(false)
  const [message, setMessage] = useState({ text: '', error: false })
  useEffect(() => {
    let stale = false
    window.snipeIt.record(kind, id).then((r) => !stale && setRecord(r), (e: Error) => !stale && setError(e.message))
    return () => { stale = true }
  }, [kind, id, version])

  if (error) return <p className="message error" role="alert">{error}</p>
  if (!record) return <p className="empty">Loading…</p>
  const stock = kind === 'accessories' || kind === 'consumables' || kind === 'licenses' ? kind : null
  const changed = () => setVersion((v) => v + 1)
  // Throws nothing: CheckoutForm waits on it, and a refusal shows here as Snipe-IT's reason.
  async function checkoutStock(stockKind: StockKind, userId: number, qty: number, note?: string) {
    try {
      await window.snipeIt.checkoutStock(stockKind, id, { userId, qty, note })
      setMessage({ text: `Checked out ${qty}`, error: false })
      setCheckingOut(false)
      changed()
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true })
    }
  }
  const checkoutOff = !record.can.checkout ? NOT_ALLOWED : record.remaining === 0 ? 'None left' : undefined
  return (
    <>
      <header className="head">
        <h1><span className="dim">{listName[kind]} / </span>{record.name || '—'}</h1>
        <div className="actions">
          {(kind === 'categories' ? CATEGORY_LISTS[record.categoryType ?? ''] ?? [] : RELATED[kind] ?? []).map(([label, list, filter]) => (
            <button key={label} className="quiet"
              onClick={() => onDrill(list, { filters: { [filter]: String(id) }, label: drillLabel(kind, record.name) })}>
              {label}
            </button>
          ))}
          {stock && <button disabled={!!checkoutOff} title={checkoutOff} onClick={() => (setCheckingOut((o) => !o), setMessage({ text: '', error: false }))}>{checkingOut ? 'Cancel' : 'Checkout…'}</button>}
          {editable(kind) && (
            <>
              <button className="quiet" onClick={() => onEdit(kind, id)} disabled={!record.can.update} title={record.can.update ? undefined : NOT_ALLOWED}>Edit</button>
              <DeleteButton kind={kind} id={id} name={record.name} onDeleted={() => onDeleted(kind, id, record.name)} allowed={record.can.delete} />
            </>
          )}
        </div>
      </header>
      {message.text && <p className={message.error ? 'message error' : 'message list-message'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {stock && checkingOut && !checkoutOff && <CheckoutForm defaultLocation={null} available={record.remaining} onCheckout={(o) => checkoutStock(stock, o.targetId, o.qty, o.note)} onUnfinished={(text) => setMessage({ text, error: true })} />}
      <FieldGrid fields={record.fields} onOpenRecord={onOpenRecord} onOpenAsset={onOpenAsset} />
      {record.fields.length === 0 && <p className="empty">No fields</p>}
      {(kind === 'accessories' || kind === 'licenses') && <HoldersSection kind={kind} id={id} canCheckin={record.can.checkin} version={version} onChanged={changed} onOpenRecord={onOpenRecord} />}
      {kind === 'users' && <UserHeldSection kind="accessories" userId={id} onOpenRecord={onOpenRecord} />}
      {kind === 'users' && <UserHeldSection kind="licenses" userId={id} onOpenRecord={onOpenRecord} />}
      {kind === 'users' && <UserAccessSection userId={id} canManage={canManage} />}
    </>
  )
}

export function FieldGrid({ fields, onOpenRecord, onOpenAsset }: { fields: Field[]; onOpenRecord: (kind: RecordKind, id: number) => void; onOpenAsset: (id: number) => void }) {
  return (
    <dl className="facts">
      {fields.map((f, i) => {
        const link = f.link
        return (
          <Fragment key={i}>
            <dt>{f.label}</dt>
            <dd>
              {link
                ? <button className="link" onClick={() => (link.kind === 'assets' ? onOpenAsset(link.id) : onOpenRecord(link.kind, link.id))}>{f.value}</button>
                : f.value}
            </dd>
          </Fragment>
        )
      })}
    </dl>
  )
}
