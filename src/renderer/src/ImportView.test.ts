import { describe, expect, it } from 'vitest'
import { matchColumns } from './ImportView'

describe('matching columns to fields', () => {
  it("matches a heading that is a field's name or label, in any case and with _ for spaces; the rest aren't matched", () => {
    expect(matchColumns(['Asset Tag', 'serial number', 'asset_model', ' Status ', 'Cart'], 'asset'))
      .toEqual({ 'Asset Tag': 'asset_tag', 'serial number': 'serial', asset_model: 'asset_model', ' Status ': 'status', Cart: '' })
  })

  it('a CSV imported before as the same type keeps its matching; headings it left out are matched as usual', () => {
    const before = { type: 'user' as const, mapping: { Login: 'username', Surname: 'last_name' } }
    expect(matchColumns(['Login', 'Surname', 'Email'], 'user', before)).toEqual({ Login: 'username', Surname: 'last_name', Email: 'email' })
    // As another type, its old matching doesn't apply.
    expect(matchColumns(['Login', 'Email'], 'location', before)).toEqual({ Login: '', Email: '' })
  })
})
