import { describe, expect, it } from 'vitest'
import { choices, filterPick } from './ListView'

describe('filter boxes', () => {
  const location = { label: 'Any Location', options: [{ value: '4', label: 'Room 1201' }, { value: '9', label: 'Room 12' }] }

  it('a whole name picks that choice, even when it starts another', () => {
    expect(filterPick(location, 'Room 12')).toBe('9')
    expect(filterPick(location, 'Room 1201')).toBe('4')
  })

  it('part of a name picks nothing yet, so the List keeps its filter while the Operator types', () => {
    expect(filterPick(location, 'Room 120')).toBeNull()
  })

  it('choices with the same name each get their id, so either can be picked', () => {
    const twins = { label: 'Any Location', options: [{ value: '3', label: 'Room 101' }, { value: '8', label: 'Room 101' }, { value: '5', label: 'Gym' }] }
    expect(choices(twins).map((o) => o.label)).toEqual(['Room 101 (id 3)', 'Room 101 (id 8)', 'Gym'])
    expect(filterPick(twins, 'Room 101 (id 8)')).toBe('8')
    expect(filterPick(twins, 'Room 101')).toBeNull()
  })

  it('a choice named like the "Any …" prompt can still be picked', () => {
    const odd = { label: 'Any category', options: [{ value: '2', label: 'Any category' }] }
    expect(filterPick(odd, 'Any category (id 2)')).toBe('2')
    expect(filterPick(odd, 'Any category')).toBe('')
  })

  it('"Any …" or an empty box clears the filter', () => {
    expect(filterPick(location, 'Any Location')).toBe('')
    expect(filterPick(location, '  ')).toBe('')
  })
})
