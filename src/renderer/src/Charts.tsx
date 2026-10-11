import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { scaleBand, scaleLinear } from 'd3-scale'
import { arc, line, pie } from 'd3-shape'
import type { Failed, StatusTally, Tally, Week } from '../../main/snipeit'
import type { Drill } from './ListView'

/** The dashboard charts of Assets, each counted by one field, and the Assets List filter its marks open. */
const FILTER = { assets: 'status_id', categories: 'category_id', locations: 'location_id' } as const
export type ChartPiece = keyof typeof FILTER
/** One mark of a chart, legend row or table row; drill (an Assets List filter, or a Checkouts week) is left out where it
 * opens nothing (Other, No Location). */
export type ChartRow<D = Drill> = { key: string; name: string; count: number; color: string; drill?: D }

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
 * unit: what the numbers count. dots: each table row shows its mark's color as a status dot (the Status Labels). */
export function ChartCard<D = Drill>({ title, column, unit = 'Assets', dots, rows, onDrill, children }: {
  title: string
  column: string
  unit?: string
  dots?: boolean
  rows: ChartRow<D>[] | Failed | undefined
  onDrill: (d: D) => void
  children: (rows: ChartRow<D>[]) => ReactNode
}) {
  const [table, setTable] = useState(false)
  const name = (r: ChartRow<D>, inner: ReactNode) => (r.drill ? <button className="link" onClick={() => onDrill(r.drill!)}>{inner}</button> : inner)
  return (
    <section className="card chart-card" aria-label={title}>
      <header>
        <h2>{title}</h2>
        {Array.isArray(rows) && rows.length > 0 && <button className={`quiet${table ? ' on' : ''}`} aria-pressed={table} onClick={() => setTable((t) => !t)}>Table</button>}
      </header>
      {!rows ? <p className="dim">Loading…</p>
        : 'error' in rows ? <p className="message error" role="alert">{rows.error}</p>
        : rows.length === 0 ? <p className="dim">No {unit}</p>
        : table ? (
          <div className="chart-table"><table className="history">
            <thead><tr><th>{column}</th><th className="num">{unit}</th></tr></thead>
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

const dateOf = (week: string) => new Date(`${week}T00:00`)
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const month = new Intl.DateTimeFormat(undefined, { month: 'short' })
const checkouts = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'Checkout' : 'Checkouts'}`

/** Checkouts over time's rows, oldest week first, each opening its week; the current week, last, is so far. */
export const weekRows = (weeks: Week[]): ChartRow<string>[] =>
  weeks.map((w, i) => ({ key: w.week, name: `${day.format(dateOf(w.week))}${i === weeks.length - 1 ? ' (so far)' : ''}`, count: w.count, color: 'var(--series-1)', drill: w.week }))

const LM = { top: 18, right: 64, bottom: 28, left: 36 }

/** Checkouts over time: one 2px line, a point per week, the current week dashed and labelled "so far", y from 0. A crosshair
 * tooltip gives the week and its count. One Tab stop: the arrow keys step weeks, Enter (or a click) opens the week. */
export function WeekLine({ rows, onDrill }: { rows: ChartRow<string>[]; onDrill: (week: string) => void }) {
  const [ref, width] = useWidth()
  const [at, setAt] = useState<number | null>(null)
  const last = rows.length - 1
  const x = scaleLinear([0, last], [LM.left, Math.max(LM.left, width - LM.right)])
  const y = scaleLinear([0, Math.max(1, ...rows.map((r) => r.count))], [H - LM.bottom, LM.top]).nice()
  const points = rows.map((r, i): [number, number] => [x(i), y(r.count)])
  const path = line()
  // A month's name under its first week; every other month when narrow.
  const months = rows.flatMap((r, i) => (+r.key.slice(8) <= 7 ? [i] : [])).filter((_, n) => width >= 560 || n % 2 === 0)
  const step = (by: number) => setAt((i) => Math.min(last, Math.max(0, (i ?? last) + by)))
  const open = (i: number | null) => i !== null && rows[i].drill && onDrill(rows[i].drill!)
  const keys: Record<string, () => void> = {
    ArrowLeft: () => step(-1), ArrowRight: () => step(1), Home: () => setAt(0), End: () => setAt(last), Enter: () => open(at),
  }
  const shown = at === null ? null : rows[at]
  return (
    <div ref={ref} className="week-line" tabIndex={0} role="group"
      aria-label="Asset Checkouts per week. Left and Right arrows step through the weeks; Enter opens the week in the Activity Report."
      onFocus={() => setAt((i) => i ?? last)} onBlur={() => setAt(null)}
      onKeyDown={(e) => { if (keys[e.key]) e.preventDefault(), keys[e.key]() }}>
      {width > 0 && (
        <svg width={width} height={H} onClick={() => open(at)} onPointerLeave={() => document.activeElement !== ref.current && setAt(null)}
          onPointerMove={(e) => setAt(Math.min(last, Math.max(0, Math.round(x.invert(e.clientX - e.currentTarget.getBoundingClientRect().left)))))}>
          {y.ticks(4).map((t) => (
            <g key={t} className="tick">
              <line x1={LM.left} x2={width - LM.right} y1={y(t)} y2={y(t)} />
              <text x={LM.left - 6} y={y(t)} dy="0.32em">{compact.format(t)}</text>
            </g>
          ))}
          {months.map((i) => <text key={i} className="month" x={x(i)} y={H - LM.bottom + 18}>{month.format(dateOf(rows[i].key))}</text>)}
          <path className="line" d={path(points.slice(0, -1)) ?? ''} />
          <path className="line so-far" d={path(points.slice(-2)) ?? ''} />
          <text className="end" x={x(last) + 8} y={y(rows[last].count)} dy="0.32em">{rows[last].count.toLocaleString()} so far</text>
          {shown && (
            <g className="crosshair">
              <line x1={x(at!)} x2={x(at!)} y1={LM.top} y2={H - LM.bottom} />
              <circle cx={x(at!)} cy={y(shown.count)} r="4" />
            </g>
          )}
        </svg>
      )}
      {/* Always in the page, so a screen reader hears each week as the arrow keys step to it. */}
      <div className="tip" role="status" aria-live="polite" hidden={!shown}
        style={shown ? at! > last / 2 ? { right: width - x(at!) + 10 } : { left: x(at!) + 10 } : undefined}>
        {shown && <><b>{checkouts(shown.count)}</b><span>Week of {shown.name}</span></>}
      </div>
    </div>
  )
}
