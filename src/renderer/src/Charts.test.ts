import { describe, expect, it } from 'vitest'
import { chartRows, fold } from './Charts'

const label = (id: number | null, name: string, type: string, color: string | null, count: number) => ({ id, name, type, color, count })

describe('dashboard chart rows', () => {
  it("colours a Status Label in Snipe-IT's color, or look B's status token for its kind when it has none", () => {
    const rows = chartRows('assets', [
      label(1, 'Ready to Deploy', 'deployable', '#2ea043', 9), label(2, 'Deployed', 'deployable', null, 8), label(5, 'Pending', 'pending', null, 4),
      label(3, 'Damaged', 'undeployable', null, 3), label(6, 'Archived', 'archived', null, 2), label(null, 'No Status Label', '', null, 1),
    ])
    expect(rows.map((r) => r.color)).toEqual(['#2ea043', 'var(--green)', 'var(--amber)', 'var(--red)', 'var(--grey)', 'var(--grey)'])
  })

  it('Category and Location bars are all --series-1', () => {
    expect(chartRows('categories', [{ id: 1, name: 'Chromebook', count: 3 }])[0].color).toBe('var(--series-1)')
  })

  it('a mark opens the Assets List filtered by status_id, category_id or location_id; No Location opens nothing', () => {
    expect(chartRows('assets', [label(6, 'Archived', 'archived', null, 2)])[0].drill).toEqual({ filters: { status_id: '6' } })
    expect(chartRows('categories', [{ id: 4, name: 'Tablet', count: 3 }])[0].drill).toEqual({ filters: { category_id: '4' } })
    const [room, none] = chartRows('locations', [{ id: 3, name: 'Room 101', count: 5 }, { id: null, name: 'No Location', count: 2 }])
    expect(room.drill).toEqual({ filters: { location_id: '3' } })
    expect(none).toEqual({ key: 'none:No Location', name: 'No Location', count: 2, color: 'var(--series-1)' })
  })

  it('keeps the top N and folds the rest into one Other that opens nothing', () => {
    const rows = chartRows('categories', Array.from({ length: 13 }, (_, i) => ({ id: i + 1, name: `C${i + 1}`, count: 20 - i })))
    const shown = fold(rows, 10, 'var(--series-1)')
    expect(shown.map((r) => r.name)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'Other'])
    expect(shown[10]).toEqual({ key: 'other', name: 'Other', count: 10 + 9 + 8, color: 'var(--series-1)' })
  })

  it('folds nothing when there are N or fewer', () => {
    const rows = chartRows('assets', [label(1, 'Deployed', 'deployable', null, 3), label(2, 'Pending', 'pending', null, 1)])
    expect(fold(rows, 5, 'var(--dim)')).toBe(rows)
  })
})
