import { describe, expect, it, vi } from 'vitest'
import { FORMS, type Asset } from '../../main/snipeit'
import { checkOutTo, isOff, withValue } from './RecordForm'

describe('New User: Enable login', () => {
  const field = (key: string) => FORMS.users.find((f) => f.key === key)!

  it('the passwords are off until Enable login is checked', () => {
    expect(isOff(field('password'), {})).toBe(true)
    expect(isOff(field('password_confirmation'), { activated: '' })).toBe(true)
    expect(isOff(field('password'), { activated: '1' })).toBe(false)
    expect(isOff(field('username'), {})).toBe(false)
  })

  it('turning Enable login off clears a password typed before; turning it on, or changing another field, keeps what is there', () => {
    const typed = { username: 'tstudent', activated: '1', password: 'Fake-Pass-2026', password_confirmation: 'Fake-Pass-2026' }
    expect(withValue(FORMS.users, typed, 'activated', '')).toEqual({ username: 'tstudent', activated: '', password: '', password_confirmation: '' })
    expect(withValue(FORMS.users, { username: 'tstudent' }, 'activated', '1')).toEqual({ username: 'tstudent', activated: '1' })
    expect(withValue(FORMS.users, typed, 'username', 'tstudent2')).toEqual({ ...typed, username: 'tstudent2' })
  })
})

describe('New User: Assets to check out', () => {
  const asset = (id: number) => ({ id, assetTag: `TEST-${id}` }) as Asset

  it('checks each Asset out to the new User in turn, and returns the ones that did not go with the reason', async () => {
    const checkout = vi.fn(async (id: number) => {
      if (id === 2) throw new Error('TEST-2 is already checked out to Test User. Check it in first.')
    })
    expect(await checkOutTo(900, [asset(1), asset(2), asset(3)], checkout)).toEqual([
      { asset: asset(2), error: 'TEST-2 is already checked out to Test User. Check it in first.' },
    ])
    expect(checkout.mock.calls).toEqual([1, 2, 3].map((id) => [id, { targetType: 'user', targetId: 900 }]))
  })

  it('nothing listed, nothing checked out', async () => {
    const checkout = vi.fn(async () => {})
    expect(await checkOutTo(900, [], checkout)).toEqual([])
    expect(checkout).not.toHaveBeenCalled()
  })
})
