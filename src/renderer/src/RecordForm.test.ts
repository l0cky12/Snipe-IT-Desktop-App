import { describe, expect, it } from 'vitest'
import { namePick } from './RecordForm'

const models = [{ id: 7, name: 'Latitude 5440' }, { id: 9, name: 'Chromebook 3100' }, { id: 12, name: 'Latitude 7450' }]

describe('a name box in the record form', () => {
  it('a whole name picks its id, ignoring case', () => {
    expect(namePick(models, 'Choose asset model', 'chromebook 3100').picked).toBe('9')
  })

  it('part of a name picks nothing yet, but still narrows the choices', () => {
    expect(namePick(models, 'Choose asset model', 'LATITUDE')).toMatchObject({ picked: null, matches: true })
  })

  it('text no choice has picks nothing and says so', () => {
    expect(namePick(models, 'Choose asset model', 'iPad')).toMatchObject({ picked: null, matches: false })
  })

  it('emptying the box clears the choice', () => {
    expect(namePick(models, 'None', '  ')).toMatchObject({ picked: '', matches: true })
  })
})
