import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { scaleBand, scaleLinear, scaleTime } from 'd3-scale'
import { arc, pie } from 'd3-shape'
import type { AssetView, AuditDay, Failed, StatusTally, Tally } from '../../main/snipeit'
import type { Drill } from './ListView'

/** The dashboard charts of Assets, each counted by one field, and the Assets List filter its marks open. */
const FILTER = { assets: 'status_id', categories: 'category_id', locations: 'location_id' } as const
export type ChartPiece = keyof typeof FILTER
/** One mark of a chart, legend row or table row; drill is left out where it opens nothing (Other, No Location). */
export type ChartRow = { key: string; name: string; count: number; color: string; drill?: Drill }

// A Status Label with no color of its own takes look B's status token for its kind.
const STATUS_TOKEN: Record<string, string> = { deployable: 'green', pending: 'amber', undeployable: 'red', archived: 'grey' }

/** Every row of a chart, most first as Snipe-IT's counts came: Status Labels in their own colors, the bars in --series-1. */
export function chartRows(piece: ChartPiece, tallies: (Tally | StatusTally)[]): ChartRow[] {
  return tallies.map((t) => ({
    key: String(t.id ?? `none:${t.name}`),
    name: t.name,
    count: t.count,
    color: piece !== 'assets' ? 'var(--series-1)' : (t as StatusTally).color ?? `var(--${STATUS_TOKEN[(t as StatusTally).type] ?? 'grey'})`,
    ...(t.id !== null && { drill: { filters: { [FILTER[piece]]: String(t.id) } } }),
  }))
}

/** The first n rows, and the rest folded into one "Other" that opens nothing (the Table lists each of them). */
export function fold(rows: ChartRow[], n: number, otherColor: string): ChartRow[] {
  if (rows.length <= n) return rows
  return [...rows.slice(0, n), { key: 'other', name: 'Other', count: rows.slice(n).reduce((sum, r) => sum + r.count, 0), color: otherColor }]
}

const assets = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'Asset' : 'Assets'}`
const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })

/** A chart on its card, with a Table toggle showing the same numbers as rows. rows is every row, before any folding.
 * dots: each table row shows its mark's color as a status dot (the Status Labels). onRow: what a table row opens instead of
 * its drill (an Upcoming audits day). empty: shown when there are no rows. wide: the card spans the full row. */
export function ChartCard({ title, column, dots, wide, rows, onDrill, onRow, empty, children }: {
  title: string
  column: string
  dots?: boolean
  wide?: boolean
  rows: ChartRow[] | Failed | undefined
  onDrill: (d: Drill) => void
  onRow?: (r: ChartRow) => void
  empty?: ReactNode
  children: (rows: ChartRow[]) => ReactNode
}) {
  const [table, setTable] = useState(false)
  const name = (r: ChartRow, inner: ReactNode) => {
    const go = onRow ? () => onRow(r) : r.drill && (() => onDrill(r.drill!))
    return go ? <button className="link" onClick={go}>{inner}</button> : inner
  }
  return (
    <section className={`card chart-card${wide ? ' wide' : ''}`} aria-label={title}>
      <header>
        <h2>{title}</h2>
        {Array.isArray(rows) && rows.length > 0 && <button className={`quiet${table ? ' on' : ''}`} aria-pressed={table} onClick={() => setTable((t) => !t)}>Table</button>}
      </header>
      {!rows ? <p className="dim">Loading…</p>
        : 'error' in rows ? <p className="message error" role="alert">{rows.error}</p>
        : rows.length === 0 ? empty ?? <p className="dim">No Assets</p>
        : table ? (
          <div className="chart-table"><table className="history">
            <thead><tr><th>{column}</th><th className="num">Assets</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{name(r, dots ? <span className="chip" style={{ '--dot': r.color } as CSSProperties}>{r.name}</span> : r.name)}</td>
                  <td className="num">{r.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : children(rows)}
    </section>
  )
}

/** Assets by Status Label: the 5 largest plus Other, the total in the hole, and a legend of every label (one Tab stop each). */
export function Donut({ rows, onDrill }: { rows: ChartRow[]; onDrill: (d: Drill) => void }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0)
  const slices = pie<ChartRow>().value((r) => r.count).sort(null)(fold(rows, 5, 'var(--dim)'))
  const ring = arc<(typeof slices)[number]>().innerRadius(54).outerRadius(80)
  return (
    <div className="donut">
      <svg viewBox="-82 -82 164 164" width="164" height="164" role="img" aria-label={`${assets(total)} by Status Label`}>
        {/* Mouse only: the legend underneath is the keyboard's way in. The --bg stroke is the 2px gap between slices. */}
        {slices.map((s) => (
          <path key={s.data.key} d={ring(s) ?? ''} fill={s.data.color} className={s.data.drill ? 'go' : undefined} onClick={s.data.drill && (() => onDrill(s.data.drill!))}>
            <title>{`${s.data.name}: ${assets(s.data.count)}`}</title>
          </path>
        ))}
        <text className="donut-total" y="2">{total.toLocaleString()}</text>
        <text className="donut-unit" y="20">{total === 1 ? 'Asset' : 'Assets'}</text>
      </svg>
      <ul className="legend">
        {rows.map((r) => {
          const text = <><span className="chip" style={{ '--dot': r.color } as CSSProperties}>{r.name}</span> <b>{r.count.toLocaleString()}</b></>
          return <li key={r.key}>{r.drill ? <button onClick={() => onDrill(r.drill!)}>{text}</button> : <span>{text}</span>}</li>
        })}
      </ul>
    </div>
  )
}

// The rendered width of an element, so a chart draws at its real size and its text stays 12px.
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const watch = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    watch.observe(ref.current!)
    return () => watch.disconnect()
  }, [])
  return [ref, width] as const
}

const H = 240, M = { top: 18, right: 4, bottom: 64, left: 36 }
const short = (name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name)

/** Assets by Category or Location: vertical bars, the 10 largest plus Other, largest first. Each bar that opens a List is a Tab stop. */
export function Bars({ rows, onDrill }: { rows: ChartRow[]; onDrill: (d: Drill) => void }) {
  const [ref, width] = useWidth()
  const shown = fold(rows, 10, 'var(--series-1)')
  const x = scaleBand(shown.map((r) => r.key), [M.left, Math.max(M.left, width - M.right)]).padding(0.2)
  const y = scaleLinear([0, Math.max(...shown.map((r) => r.count))], [H - M.bottom, M.top]).nice()
  const w = Math.min(24, x.bandwidth())
  const base = y(0)
  return (
    <div ref={ref} className="bars">
      {width > 0 && (
        <svg width={width} height={H}>
          {y.ticks(4).map((t) => (
            <g key={t} className="tick">
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
              <text x={M.left - 6} y={y(t)} dy="0.32em">{compact.format(t)}</text>
            </g>
          ))}
          {shown.map((r) => {
            const left = x(r.key)! + (x.bandwidth() - w) / 2, top = y(r.count), mid = left + w / 2
            const rad = Math.min(4, w / 2, base - top)
            // 4px rounded data end, square at the baseline.
            const bar = `M${left},${base}V${top + rad}Q${left},${top} ${left + rad},${top}H${left + w - rad}Q${left + w},${top} ${left + w},${top + rad}V${base}Z`
            const go = r.drill && (() => onDrill(r.drill!))
            return (
              <g key={r.key} className={go ? 'go' : undefined} {...(go && {
                tabIndex: 0, role: 'link', 'aria-label': `${r.name}: ${assets(r.count)}`, onClick: go,
                onKeyDown: (e: KeyboardEvent) => e.key === 'Enter' && go(),
              })}>
                <title>{`${r.name}: ${assets(r.count)}`}</title>
                {/* The whole band is the hit target, not just the bar, and its outline the focus ring (the group's would take in the label). */}
                <rect className="hit" x={x(r.key)} y={M.top} width={x.bandwidth()} height={base - M.top} fill="transparent" />
                <path d={bar} fill={r.color} />
                <text className="cap" x={mid} y={top - 5}>{r.count.toLocaleString()}</text>
                <text className="label" transform={`translate(${mid},${base + 10}) rotate(-40)`}>{short(r.name)}</text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

/** The Next major audit: the day with the most Assets due, the earlier day on a tie (days come soonest first). */
export function nextMajorAudit(days: AuditDay[]): AuditDay | undefined {
  return days.reduce<AuditDay | undefined>((most, d) => (!most || d.assets.length > most.assets.length ? d : most), undefined)
}

// A Snipe-IT day ("YYYY-MM-DD") as a local date, and written out as "Thu 12 Aug 2027" (parts joined by hand: no commas).
const dateOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const dayParts = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
export function longDay(day: string): string {
  const p = Object.fromEntries(dayParts.formatToParts(dateOf(day)).map((x) => [x.type, x.value]))
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`
}
/** The Upcoming audits table's rows: one per day, soonest first. */
export const auditRows = (days: AuditDay[]): ChartRow[] =>
  days.map((d) => ({ key: d.day, name: longDay(d.day), count: d.assets.length, color: 'var(--series-1)' }))

const TH = 150, TM = { top: 30, right: 16, bottom: 24, left: 36 }
const month = new Intl.DateTimeFormat('en-US', { month: 'short' })

/** A pinned Audit late or Audit due count: Snipe-IT's own total from the Health check, opening that View. */
function AuditCount({ view, name, tone, total, onView }: {
  view: AssetView; name: string; tone: 'red' | 'amber'; total: number | Failed | undefined; onView: (v: AssetView) => void
}) {
  if (total === undefined) return <li className="dim">{name}: checking…</li>
  if (typeof total !== 'number') return <li className="dim" title={total.error}>{name}: couldn't check</li>
  return <li><button className={`link chip c-${tone}`} onClick={() => onView(view)}><b>{total.toLocaleString()}</b> {name}</button></li>
}

/**
 * Upcoming audits: a time axis from today to 12 months ahead, one marker per day with Assets due (taller for more), and the
 * Next major audit emphasised and labelled. Audit late and Audit due are pinned left of today. The strip is one Tab stop:
 * the arrow keys step between days, Enter opens a day. dueThrough shades Audit due as far as Snipe-IT's own Audit due
 * Assets reach, since its Audit warning setting can't be read.
 */
export function Timeline({ days, late, due, dueThrough, onDay, onView }: {
  days: AuditDay[]
  late: number | Failed | undefined
  due: number | Failed | undefined
  dueThrough: string | null
  onDay: (d: AuditDay) => void
  onView: (v: AssetView) => void
}) {
  const [ref, width] = useWidth()
  const major = nextMajorAudit(days)
  const [active, setActive] = useState(-1)
  const at = active >= 0 && active < days.length ? active : Math.max(0, days.indexOf(major!))
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate())
  const x = scaleTime([start, end], [TM.left, Math.max(TM.left, width - TM.right)])
  const y = scaleLinear([0, major?.assets.length ?? 1], [TH - TM.bottom, TM.top]).nice()
  const base = y(0)
  const xs = days.map((d) => x(dateOf(d.day)))
  const step = (e: KeyboardEvent<SVGGElement>, i: number) => {
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: days.length - 1 }[e.key]
    if (e.key === 'Enter') onDay(days[i])
    if (to === undefined || to < 0 || to >= days.length) return
    e.preventDefault()
    setActive(to)
    ;(e.currentTarget.parentNode?.children[to] as SVGGElement | undefined)?.focus()
  }
  const through = dueThrough ? dateOf(dueThrough) : null
  // To the end of the last Audit due day.
  const shadeTo = through && through >= start ? x(new Date(through.getFullYear(), through.getMonth(), through.getDate() + 1)) : null
  return (
    <div className="audits">
      {major && (
        <p className="audit-next">Next major audit: <button className="link" onClick={() => onDay(major)}>{longDay(major.day)} · {assets(major.assets.length)}</button></p>
      )}
      <div className="audit-strip">
        <ul className="audit-now" aria-label="Audit late and Audit due">
          <AuditCount view="auditLate" name="Audit late" tone="red" total={late} onView={onView} />
          <AuditCount view="auditDue" name="Audit due" tone="amber" total={due} onView={onView} />
        </ul>
        <div ref={ref} className="timeline">
          {width > 0 && (
            <svg width={width} height={TH}>
              {shadeTo !== null && <>
                <rect className="due" x={x(start)} y={TM.top - 14} width={Math.max(2, shadeTo - x(start))} height={base - TM.top + 14} />
                <text className="due-label" x={x(start) + 4} y={TM.top - 3}>Audit due</text>
              </>}
              {y.ticks(3).map((t) => (
                <g key={t} className="tick">
                  {t > 0 && <line x1={TM.left} x2={width - TM.right} y1={y(t)} y2={y(t)} />}
                  <text x={TM.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{compact.format(t)}</text>
                </g>
              ))}
              <line className="axis" x1={TM.left} x2={width - TM.right} y1={base} y2={base} />
              <text className="month" x={x(start)} y={TH - 6}>Today</text>
              {x.ticks(12).filter((t) => x(t) - x(start) > 40).map((t) => (
                <text key={+t} className="month" x={x(t)} y={TH - 6}>{t.getMonth() ? month.format(t) : t.getFullYear()}</text>
              ))}
              {days.length === 0 && <text className="month" x={(x(start) + x(end)) / 2} y={base - 12} textAnchor="middle">Nothing due in the next 12 months</text>}
              <g role="group" aria-label="Days with Assets due">
                {days.map((d, i) => {
                  const big = d === major, r = big ? 7 : 5, top = y(d.assets.length)
                  const label = `${longDay(d.day)}: ${assets(d.assets.length)}${big ? ', the Next major audit' : ''}`
                  // Each day's hit area runs halfway to its neighbours, so a pointer near a marker finds it.
                  const left = i ? (xs[i - 1] + xs[i]) / 2 : xs[i] - 12, right = i < days.length - 1 ? (xs[i] + xs[i + 1]) / 2 : xs[i] + 12
                  return (
                    <g key={d.day} role="link" className={`day${big ? ' major' : ''}`} tabIndex={i === at ? 0 : -1} aria-label={label}
                      onClick={() => onDay(d)} onKeyDown={(e) => step(e, i)} onFocus={() => setActive(i)}>
                      <title>{label}</title>
                      <rect className="hit" x={left} y={TM.top} width={Math.max(1, right - left)} height={base - TM.top} fill="transparent" />
                      <line className="stem" x1={xs[i]} x2={xs[i]} y1={base} y2={top} />
                      <circle className="ring" cx={xs[i]} cy={top} r={r + 3} />
                      <circle cx={xs[i]} cy={top} r={r} />
                      {big && <text className="cap" x={xs[i]} y={top - 11}>{d.assets.length.toLocaleString()}</text>}
                    </g>
                  )
                })}
              </g>
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
