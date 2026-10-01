import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSettingsStore, type Schedule, type ScheduleKey } from './config'
import type { Mail } from './mail'
import { createReportScheduler, reportRunner, type ReportRef, type ReportRun } from './scheduler'

const overdue: ReportRun = { name: 'Overdue', columns: ['Asset Tag', 'Assignee'], rows: [['NOMMA-1', 'J. R.'], ['NOMMA-2', '=1+1']], capped: false }
// The Report scheduler on a fake clock, a fake Report and a fake sender: what it emails, and to whom.
function scheduler({ email = 'ecaldwell@nomma.net', report = overdue } = {}) {
  const sent: Mail[] = []
  const ran: unknown[] = []
  const s = createReportScheduler({
    now: () => new Date(2026, 9, 1, 23, 30),
    recipient: async () => email,
    run: async (ref) => (ran.push(ref), report),
    send: async (mail) => void sent.push(mail),
    schedules: () => [],
    recordSend: () => {},
  })
  return { s, sent, ran }
}

describe('Email me now', () => {
  it("emails the Report to the Operator: its name and the day in the subject, the row count in the body, the CSV as Export writes it", async () => {
    const { s, sent, ran } = scheduler()
    expect(await s.emailNow({ builtIn: 'overdue', query: {} })).toEqual({ to: 'ecaldwell@nomma.net', rows: 2 })
    expect(ran).toEqual([{ builtIn: 'overdue', query: {} }])
    expect(sent).toHaveLength(1)
    const [mail] = sent
    expect(mail.to).toBe('ecaldwell@nomma.net')
    expect(mail.subject).toBe('Overdue, 2026-10-01')
    expect(mail.text).toMatch(/^Overdue has 2 rows\./)
    expect(mail.attachments).toEqual([{ filename: 'overdue-2026-10-01.csv', contentType: 'text/csv; charset=utf-8',
      content: '\uFEFF"Asset Tag","Assignee"\r\n"NOMMA-1","J. R."\r\n"NOMMA-2","\'=1+1"\r\n' }])
  })

  it('an empty Report still emails, saying 0 rows', async () => {
    const { s, sent } = scheduler({ report: { ...overdue, name: 'Lab Chromebooks', rows: [] } })
    expect(await s.emailNow({ saved: 'r1' })).toEqual({ to: 'ecaldwell@nomma.net', rows: 0 })
    expect(sent[0].text).toMatch(/^Lab Chromebooks has 0 rows\./)
    expect(sent[0].attachments?.[0].content).toBe('\uFEFF"Asset Tag","Assignee"\r\n')
  })

  it('one row is "1 row"; a Report cut short says so', async () => {
    const { s, sent } = scheduler({ report: { ...overdue, rows: [['NOMMA-1', '']], capped: true } })
    await s.emailNow({ builtIn: 'overdue', query: {} })
    expect(sent[0].text).toMatch(/^Overdue has 1 row\..*only the first 1 row/s)
  })

  it('refuses, saying why, unless the Operator\'s Snipe-IT email is at nomma.net; nothing is run or sent', async () => {
    for (const email of ['jordan@gmail.com', 'x@nomma.net.evil.com', 'x@notnomma.net', 'nomma.net']) {
      const { s, sent, ran } = scheduler({ email })
      await expect(s.emailNow({ saved: 'r1' })).rejects.toThrow(`only to @nomma.net addresses, and your Snipe-IT email is ${email}`)
      expect([sent, ran]).toEqual([[], []])
    }
  })

  it('the domain may be in capitals', async () => {
    const { s, sent } = scheduler({ email: 'ECaldwell@NOMMA.NET' })
    await s.emailNow({ saved: 'r1' })
    expect(sent[0].to).toBe('ECaldwell@NOMMA.NET')
  })
})

describe('running a Report to rows', () => {
  const saved = { id: 'r1', name: 'Library loans', kind: 'assets' as const, search: 'CB', filters: { location_id: '4' }, sort: { key: 'name', order: 'desc' as const }, columns: ['assetTag', 'assignee'] }
  const asset = { id: 1, assetTag: 'NOMMA-1', assignee: { type: 'user', id: 3, name: 'J. R.' } }
  const asked: unknown[] = []
  const client = {
    exportList: async (...args: unknown[]) => (asked.push(args), { rows: [asset], capped: true }),
    report: async (...args: unknown[]) => (asked.push(args), { columns: ['Asset Tag'], rows: [['NOMMA-1']], capped: false }),
  }
  const run = reportRunner(client as never, () => [saved])

  it('a Saved Report is its List as saved: search, filters, sort and Columns', async () => {
    expect(await run({ saved: 'r1' })).toEqual({ name: 'Library loans', columns: ['Asset Tag', 'Assignee'], rows: [['NOMMA-1', 'J. R.']], capped: true })
    expect(asked.pop()).toEqual(['assets', { search: 'CB', filters: { location_id: '4' }, sort: 'name', order: 'desc' }])
  })

  it('a built-in Report runs with its filters, under its name', async () => {
    expect(await run({ builtIn: 'overdue', query: { from: '2026-09-01' } })).toEqual({ name: 'Overdue', columns: ['Asset Tag'], rows: [['NOMMA-1']], capped: false })
    expect(asked.pop()).toEqual(['overdue', { from: '2026-09-01' }])
  })

  it('a deleted Saved Report says so', async () => {
    await expect(run({ saved: 'gone' })).rejects.toThrow('That Saved Report no longer exists.')
  })
})

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret' as const, encryptString: () => Buffer.from(''), decryptString: () => '' }
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)

// The Report scheduler on a fake clock and a fake sender, keeping its schedules in a real settings store on a temporary
// folder. restart(): the app quits and launches again, on the same settings.
function scheduled(schedules: [ScheduleKey, Schedule][], { setAt = at(1, 6), fail = '' } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'snipe-scheduler-')), 'settings.json')
  dirs.push(join(path, '..'))
  const t = { clock: setAt, fail, sent: [] as string[], ran: [] as ReportRef[] }
  const launch = () => {
    const store = createSettingsStore(path, storage, '0.1.0')
    return { store, scheduler: createReportScheduler({
      now: () => t.clock,
      recipient: async () => 'ecaldwell@nomma.net',
      run: async (ref) => (t.ran.push(ref), overdue),
      send: async (mail) => { if (t.fail) throw new Error(t.fail); t.sent.push(`${mail.subject} @ ${t.clock.toString().slice(4, 21)}`) },
      schedules: store.schedules,
      recordSend: store.recordSend,
    }) }
  }
  let app = launch()
  for (const [key, schedule] of schedules) {
    if ('saved' in key) key.saved = app.store.saveReport({ name: 'Lab', kind: 'assets', search: '', filters: {}, sort: null, columns: [] }).id
    app.store.setSchedule(key, schedule, setAt)
  }
  // Ticks at each time, as the minute timer does while the app runs.
  const tick = async (...times: Date[]) => { for (const time of times) { t.clock = time; await app.scheduler.tick() } }
  return Object.assign(t, { tick, restart: () => void (app = launch()), last: () => app.store.schedules()[0].schedule.last })
}

describe('scheduled Reports', () => {
  it('daily: sends at the time each day, once', async () => {
    const t = scheduled([[{ builtIn: 'overdue' }, { every: 'day', time: '07:00' }]])
    await t.tick(at(1, 6, 59), at(1, 7), at(1, 7, 1), at(1, 23, 59), at(2, 6, 59), at(2, 7, 0), at(2, 7, 1))
    expect(t.sent).toEqual(['Overdue, 2026-10-01 @ Oct 01 2026 07:00', 'Overdue, 2026-10-02 @ Oct 02 2026 07:00'])
  })

  it("weekly: sends on the chosen day (2026-10-01 is a Thursday), not before the time and not on other days", async () => {
    const t = scheduled([[{ builtIn: 'overdue' }, { every: 'week', day: 1, time: '08:30' }]])
    await t.tick(at(1, 8, 30), at(4, 8, 30), at(5, 8, 29), at(5, 8, 30), at(6, 8, 30), at(11, 23), at(12, 8, 31))
    expect(t.sent).toEqual(['Overdue, 2026-10-05 @ Oct 05 2026 08:30', 'Overdue, 2026-10-12 @ Oct 12 2026 08:31'])
  })

  it("monthly: sends on the chosen date, and on a shorter month's last day", async () => {
    const t = scheduled([[{ builtIn: 'overdue' }, { every: 'month', day: 31, time: '09:00' }]])
    await t.tick(at(30, 9), at(31, 8, 59), at(31, 9), at(32, 9), at(60, 9), at(61, 9), at(62, 9), at(92, 9))
    expect(t.sent).toEqual(['Overdue, 2026-10-31 @ Oct 31 2026 09:00', 'Overdue, 2026-11-30 @ Nov 30 2026 09:00', 'Overdue, 2026-12-31 @ Dec 31 2026 09:00'])
  })

  it("doesn't send for a time that passed before it was scheduled", async () => {
    const t = scheduled([[{ builtIn: 'overdue' }, { every: 'day', time: '07:00' }]], { setAt: at(1, 8) })
    await t.tick(at(1, 8), at(1, 23))
    expect(t.sent).toEqual([])
  })

  it('a schedule missed while the app was closed sends once at the next launch, and then keeps its times', async () => {
    const t = scheduled([[{ builtIn: 'overdue' }, { every: 'day', time: '07:00' }]])
    await t.tick(at(1, 7))
    // Closed from the 1st's evening until the 5th at noon: four sends missed.
    t.restart()
    await t.tick(at(5, 12), at(5, 12, 1), at(5, 23))
    t.restart()
    await t.tick(at(5, 23, 30), at(6, 7))
    expect(t.sent).toEqual(['Overdue, 2026-10-01 @ Oct 01 2026 07:00', 'Overdue, 2026-10-05 @ Oct 05 2026 12:00', 'Overdue, 2026-10-06 @ Oct 06 2026 07:00'])
  })

  it('a tick still sending when the next one comes sends nothing twice', async () => {
    const t = scheduled([[{ builtIn: 'overdue' }, { every: 'day', time: '07:00' }]])
    const t1 = t.tick(at(1, 7))
    await t.tick(at(1, 7, 1))
    await t1
    expect(t.sent).toHaveLength(1)
  })

  it('runs a built-in Report over its relative range: the 1, 7 or 30 whole days before the send, or since the last send; none, the whole Report', async () => {
    const t = scheduled([
      [{ builtIn: 'overdue' }, { every: 'day', time: '07:00', range: 1 }],
      [{ builtIn: 'activity' }, { every: 'day', time: '07:00', range: 7 }],
    ])
    await t.tick(at(8, 7))
    const month = scheduled([[{ builtIn: 'activity' }, { every: 'day', time: '07:00', range: 30 }]])
    await month.tick(at(8, 7))
    expect([...t.ran, ...month.ran]).toEqual([
      { builtIn: 'overdue', query: { from: '2026-10-07', to: '2026-10-07' } },
      { builtIn: 'activity', query: { from: '2026-10-01', to: '2026-10-07' } },
      { builtIn: 'activity', query: { from: '2026-09-08', to: '2026-10-07' } },
    ])
    // Warranty expiring looks ahead, so a range back in time has nothing to narrow: it's never kept.
    const whole = scheduled([[{ builtIn: 'overdue' }, { every: 'day', time: '07:00' }], [{ builtIn: 'expiring' }, { every: 'day', time: '07:00', range: 7 }],
      [{ saved: '' }, { every: 'day', time: '07:00' }]])
    await whole.tick(at(1, 7))
    expect(whole.ran).toEqual([{ builtIn: 'overdue', query: {} }, { builtIn: 'expiring', query: {} }, { saved: expect.any(String) }])
  })

  it('"since the last send" runs from the last send that went out (before that, from when it was scheduled)', async () => {
    const t = scheduled([[{ builtIn: 'activity' }, { every: 'week', day: 1, time: '07:00', range: 'since' }]], { setAt: at(2, 6) })
    await t.tick(at(5, 7))
    t.fail = 'Mail server unreachable'
    await t.tick(at(12, 7))
    t.fail = ''
    await t.tick(at(19, 7))
    expect(t.ran.map((r) => 'builtIn' in r && r.query)).toEqual([
      { from: '2026-10-02', to: '2026-10-05' }, { from: '2026-10-05', to: '2026-10-12' }, { from: '2026-10-05', to: '2026-10-19' }])
  })

  it('records each send: its time and row count, or why it failed; a failed send tries again each hour until it goes out', async () => {
    const t = scheduled([[{ builtIn: 'overdue' }, { every: 'day', time: '07:00' }]])
    await t.tick(at(1, 7))
    expect(t.last()).toEqual({ at: at(1, 7).toISOString(), rows: 2 })
    t.fail = 'Wrong password'
    await t.tick(at(2, 7), at(2, 7, 1), at(2, 7, 59))
    expect(t.last()).toEqual({ at: at(2, 7).toISOString(), error: 'Wrong password' })
    expect(t.ran).toHaveLength(2)
    // Like a catch-up at launch that failed because the network wasn't up yet.
    t.fail = ''
    await t.tick(at(2, 8), at(2, 8, 1), at(2, 9), at(3, 6, 59))
    expect(t.last()).toEqual({ at: at(2, 8).toISOString(), rows: 2 })
    expect(t.sent).toEqual(['Overdue, 2026-10-01 @ Oct 01 2026 07:00', 'Overdue, 2026-10-02 @ Oct 02 2026 08:00'])
  })
})
