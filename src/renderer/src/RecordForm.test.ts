import { describe, expect, it, vi } from 'vitest'
import { FORMS, type Asset } from '../../main/snipeit'
import { checkOutTo, headButtons, isOff, scanAsset, withValue } from './RecordForm'

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

  const can = { checkout: true, checkin: true, update: true, delete: true, audit: true }
  const free = (id: number) => ({ id, assetTag: `TEST-${id}`, can, assignee: null, checkoutAllowed: true, status: 'Ready to Deploy' }) as unknown as Asset
  // A fake form: what was added, refused, and how many lookups are still out.
  function form(lookup: (tag: string) => Promise<Asset | null>) {
    const added: string[] = []
    const refused: Record<string, string> = {}
    let pending = 0
    const deps = {
      lookup, listed: () => added.map((t) => ({ asset: { assetTag: t, id: Number(t.slice(5)) } as Asset })), pending: (by: 1 | -1) => { pending += by },
      add: (_tag: string, a: Asset) => { added.push(a.assetTag) }, refuse: (tag: string, why: string) => { refused[tag] = why },
    }
    return { scan: (raw: string) => scanAsset(raw, deps), added, refused, pending: () => pending }
  }

  it('a burst of scans: each is looked up on its own, none merged or dropped, and Save waits until all are back', async () => {
    const answers: Record<string, (a: Asset) => void> = {}
    const lookup = vi.fn((tag: string) => new Promise<Asset | null>((resolve) => { answers[tag] = resolve }))
    const f = form(lookup)
    const first = f.scan('TEST-1')
    const second = f.scan('\u0002TEST-2\r')
    expect(lookup.mock.calls).toEqual([['TEST-1'], ['TEST-2']])
    expect(f.pending()).toBe(2)
    answers['TEST-2'](free(2))
    await second
    expect(f.pending()).toBe(1)
    answers['TEST-1'](free(1))
    await first
    expect(f.added).toEqual(['TEST-2', 'TEST-1'])
    expect(f.pending()).toBe(0)
  })

  it('refuses an unknown tag, one already listed, one that cannot be checked out now, and a failed lookup, each saying why', async () => {
    const out = { ...free(3), assignee: { type: 'user', id: 7, name: 'Test User' }, checkoutAllowed: false } as unknown as Asset
    const assets: Record<string, Asset | null> = { 'TEST-1': free(1), 'TEST-3': out, 'TEST-9': null }
    const f = form(async (tag) => {
      if (tag === 'TEST-5') throw new Error('Snipe-IT took too long to answer')
      return assets[tag]
    })
    for (const tag of ['TEST-1', 'TEST-1', 'TEST-3', 'TEST-9', 'TEST-5', '  ']) await f.scan(tag)
    expect(f.added).toEqual(['TEST-1'])
    expect(f.refused).toEqual({
      'TEST-1': 'TEST-1 is already listed.', 'TEST-3': 'TEST-3: Already checked out.', 'TEST-9': 'No Asset has the Asset Tag TEST-9.',
      'TEST-5': 'TEST-5: Snipe-IT took too long to answer',
    })
    expect(f.pending()).toBe(0)
  })
})

describe('New User: header buttons', () => {
  const ready = { busy: false, loaded: true, fieldsLoading: false, lookups: 0, created: null, toCheckOut: 0 }

  it("Cancel can't be pressed while the User and its Checkouts are being sent, since it couldn't take them back", () => {
    expect(headButtons(ready).cancel).toEqual({ label: 'Cancel', disabled: false })
    expect(headButtons({ ...ready, busy: true, toCheckOut: 2 })).toEqual({ cancel: { label: 'Cancel', disabled: true }, save: { label: 'Saving…', disabled: true } })
    expect(headButtons({ ...ready, busy: true, created: 900, toCheckOut: 1 })).toEqual({ cancel: { label: 'Open User', disabled: true }, save: { label: 'Checking out…', disabled: true } })
    expect(headButtons({ ...ready, created: 900, toCheckOut: 1 })).toEqual({ cancel: { label: 'Open User', disabled: false }, save: { label: 'Retry checkout', disabled: false } })
  })

  it('Save says how many Assets go with the User, and waits for Asset lookups still out', () => {
    expect(headButtons(ready).save).toEqual({ label: 'Save', disabled: false })
    expect(headButtons({ ...ready, toCheckOut: 1 }).save).toEqual({ label: 'Save and check out 1 Asset', disabled: false })
    expect(headButtons({ ...ready, toCheckOut: 3 }).save).toEqual({ label: 'Save and check out 3 Assets', disabled: false })
    expect(headButtons({ ...ready, toCheckOut: 1, lookups: 2 }).save).toEqual({ label: 'Looking up Assets…', disabled: true })
    expect(headButtons({ ...ready, created: 900 }).save.disabled).toBe(true)
  })
})
