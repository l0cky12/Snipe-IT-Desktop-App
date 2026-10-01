import { describe, expect, it } from 'vitest'
import type { Mail } from './mail'
import { createReportScheduler, reportRunner, type ReportRun } from './scheduler'

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
