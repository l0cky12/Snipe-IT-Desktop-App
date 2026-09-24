export type Config = { baseUrl: string; apiKey: string }

export type Assignee = { type: 'user' | 'location' | 'asset'; id: number; name: string }

export type Asset = {
  id: number
  assetTag: string
  name: string
  model: string
  status: string
  /** Snipe-IT's status_meta: deployed, deployable, pending, archived, undeployable */
  statusMeta: string
  assignee: Assignee | null
  location: string
  category: string
  serial: string
  purchaseDate: string | null
  warrantyEnd: string | null
}

export type LookupResult = { exact: boolean; assets: Asset[] }

export type SnipeIt = ReturnType<typeof createSnipeIt>

type SnipeItError = { status: 'error'; messages: unknown }
type Named ={ id: number; name: string } | null
type RawAsset = {
  id: number
  asset_tag: string
  name: string | null
  serial: string | null
  model: Named
  status_label: { name: string; status_meta: string } | null
  category: Named
  location: Named
  assigned_to: { id: number; name: string; type: Assignee['type'] } | null
  purchase_date: { date: string } | null
  warranty_expires: { date: string } | null
}

function toAsset(raw: RawAsset): Asset {
  return {
    id: raw.id,
    assetTag: raw.asset_tag,
    name: raw.name ?? '',
    model: raw.model?.name ?? '',
    status: raw.status_label?.name ?? '',
    statusMeta: raw.status_label?.status_meta ?? '',
    assignee: raw.assigned_to && { type: raw.assigned_to.type, id: raw.assigned_to.id, name: raw.assigned_to.name },
    location: raw.location?.name ?? '',
    category: raw.category?.name ?? '',
    serial: raw.serial ?? '',
    purchaseDate: raw.purchase_date?.date ?? null,
    warrantyEnd: raw.warranty_expires?.date ?? null,
  }
}

export function createSnipeIt(config: Config, fetch: typeof globalThis.fetch) {
  const api = `${config.baseUrl.replace(/\/+$/, '')}/api/v1`

  // Resolves to the JSON body, or { status: 'error', messages } when Snipe-IT reports an error or 404.
  // ponytail: other failures are a bare HTTP-status error; ticket 04 adds the full error mapping.
  async function get<T>(path: string): Promise<T | SnipeItError> {
    const res = await fetch(api + path, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
    })
    if (res.status === 404) return { status: 'error', messages: 'Not found' }
    if (!res.ok) throw new Error(`Snipe-IT returned HTTP ${res.status}`)
    return res.json()
  }

  const isError = (body: unknown): body is SnipeItError => (body as SnipeItError)?.status === 'error'

  return {
    async lookup(query: string): Promise<LookupResult> {
      const tag = query.trim()
      if (!tag) return { exact: false, assets: [] }
      const body = await get<RawAsset>(`/hardware/bytag/${encodeURIComponent(tag)}`)
      // Snipe-IT answers an unknown Asset Tag with a 404 or a 200-with-error, depending on version.
      return isError(body) ? { exact: false, assets: [] } : { exact: true, assets: [toAsset(body)] }
    },

    async getAsset(id: number): Promise<Asset> {
      // id arrives from the screen over IPC; check it before it becomes part of a URL.
      if (!Number.isInteger(id)) throw new Error(`Invalid Asset id: ${id}`)
      const body = await get<RawAsset>(`/hardware/${id}`)
      if (isError(body)) throw new Error(String(body.messages))
      return toAsset(body)
    },
  }
}
