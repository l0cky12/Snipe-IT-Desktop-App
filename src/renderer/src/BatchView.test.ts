import { describe, expect, it } from 'vitest'
import { eachInTurn, type Outcome } from './BatchView'

describe('batch', () => {
  it('acts on each Asset in turn, reports each outcome, and a failure does not stop the rest', async () => {
    const asked: number[] = []
    const reports: [number, Outcome][] = []
    const work = async (id: number) => {
      asked.push(id)
      if (id === 2) throw new Error('NOMMA-2 is not checked out, so there is nothing to check in.')
    }
    await eachInTurn([1, 2, 3], work, 'Checked in', (id, o) => reports.push([id, o]))
    expect(asked).toEqual([1, 2, 3])
    expect(reports).toEqual([
      [1, { state: 'working' }], [1, { state: 'done', text: 'Checked in' }],
      [2, { state: 'working' }], [2, { state: 'failed', reason: 'NOMMA-2 is not checked out, so there is nothing to check in.' }],
      [3, { state: 'working' }], [3, { state: 'done', text: 'Checked in' }],
    ])
  })

  it('stops before the next Asset once told to, e.g. when Settings point at another server', async () => {
    const asked: number[] = []
    let stopped = false
    await eachInTurn([1, 2, 3], async (id) => { asked.push(id); stopped = true }, 'Checked out', () => {}, () => stopped)
    expect(asked).toEqual([1])
  })

  it('one at a time: the next Asset waits for the one before', async () => {
    let open = 0, most = 0
    await eachInTurn([1, 2, 3], async () => { most = Math.max(most, ++open); await new Promise((r) => setTimeout(r, 2)); open-- }, 'Checked out', () => {})
    expect(most).toBe(1)
  })
})
