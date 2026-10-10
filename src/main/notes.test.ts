import { describe, expect, it } from 'vitest'
import { appNote, cleanText, liveEntries, parseAppNote, parseWorkflowNote, repairCost, undoNote, userNotesLine, workflowNote } from './notes'

// Every note in #63 §2 (fake data): written by the writer, then read back by the parser.
describe('Workflow notes round trip', () => {
  const due = '2026-10-13 14:50'
  it.each([
    [workflowNote('Bulk checkout'), '[Bulk checkout]', { workflow: 'Bulk checkout', undo: false, text: '' }],
    [workflowNote('Bulk checkout', { text: 'start of year' }), '[Bulk checkout] start of year', { workflow: 'Bulk checkout', undo: false, text: 'start of year' }],
    [workflowNote('Bulk checkout', { move: true }), '[Bulk checkout | move]', { workflow: 'Bulk checkout', undo: false, text: '', move: true }],
    [undoNote('Bulk checkout'), '[Undo] Bulk checkout', { workflow: 'Bulk checkout', undo: true }],
    [workflowNote('Bulk return'), '[Bulk return]', { workflow: 'Bulk return', undo: false, text: '' }],
    [undoNote('Bulk return'), '[Undo] Bulk return', { workflow: 'Bulk return', undo: true }],
    [undoNote('Bulk return', due), `[Undo] Bulk return [Temp checkout | due: ${due}]`, { workflow: 'Bulk return', undo: true, due }],
    [workflowNote('Repair intake', { text: 'cracked screen, dropped in hallway' }), '[Repair intake] cracked screen, dropped in hallway', { workflow: 'Repair intake', undo: false, text: 'cracked screen, dropped in hallway' }],
    [undoNote('Repair intake'), '[Undo] Repair intake', { workflow: 'Repair intake', undo: true }],
    [workflowNote('Incoming repair'), '[Incoming repair]', { workflow: 'Incoming repair', undo: false, text: '' }],
    [workflowNote('Incoming repair', { text: 'screen replaced' }), '[Incoming repair] screen replaced', { workflow: 'Incoming repair', undo: false, text: 'screen replaced' }],
    [workflowNote('Incoming repair', { text: 'No Repair intake record' }), '[Incoming repair] No Repair intake record', { workflow: 'Incoming repair', undo: false, text: 'No Repair intake record' }],
    [
      workflowNote('Incoming repair', { supplier: 'Acme Device Repair', cost: '$45', text: 'screen replaced' }),
      '[Incoming repair | supplier: Acme Device Repair | cost: 45.00] screen replaced',
      { workflow: 'Incoming repair', undo: false, text: 'screen replaced', supplier: 'Acme Device Repair', cost: '45.00' },
    ],
    [undoNote('Incoming repair'), '[Undo] Incoming repair', { workflow: 'Incoming repair', undo: true }],
    [workflowNote('Temp checkout', { due }), `[Temp checkout | due: ${due}]`, { workflow: 'Temp checkout', undo: false, text: '', due }],
    [workflowNote('Temp checkout', { due, text: 'charger too' }), `[Temp checkout | due: ${due}] charger too`, { workflow: 'Temp checkout', undo: false, text: 'charger too', due }],
    [workflowNote('Temp checkout', { move: true }), '[Temp checkout | move]', { workflow: 'Temp checkout', undo: false, text: '', move: true }],
    [undoNote('Temp checkout'), '[Undo] Temp checkout', { workflow: 'Temp checkout', undo: true }],
  ])('%s', (note, written, parsed) => {
    expect(note).toBe(written)
    expect(parseWorkflowNote(note)).toEqual(parsed)
  })
})

// #63 §5: one Asset's entries, oldest first. Each [Undo] W cancels the newest earlier live entry for W.
describe('Undo pairing', () => {
  const due = '2026-10-13 14:50'
  const e = (id: number, action: string, note: string | null) => ({ id, action, note })
  const live = (entries: ReturnType<typeof e>[]) => liveEntries(entries).map((x) => x.id)

  it('a plain undo cancels its entry, and both drop out', () => {
    expect(live([e(1, 'checkout', '[Bulk checkout]'), e(2, 'checkout', '[Bulk checkout] spare'), e(3, 'checkin from', '[Undo] Bulk checkout')])).toEqual([1])
  })

  it('an undo only cancels its own Workflow; other entries and notes stay', () => {
    expect(live([e(1, 'checkout', '[Bulk checkout]'), e(2, 'update', 'fixed the Serial'), e(3, 'checkin from', '[Bulk return]'), e(4, 'checkout', '[Undo] Bulk checkout')]))
      .toEqual([2, 3])
  })

  it('a Move row and its two-call undo all drop out', () => {
    const move = [e(1, 'checkin from', '[Bulk checkout | move]'), e(2, 'checkout', '[Bulk checkout]')]
    expect(live([...move, e(3, 'checkin from', '[Undo] Bulk checkout'), e(4, 'checkout', '[Undo] Bulk checkout')])).toEqual([])
  })

  it('an undo of a Move that only half worked leaves the move Checkin live', () => {
    const move = [e(1, 'checkin from', '[Temp checkout | move]'), e(2, 'checkout', `[Temp checkout | due: ${due}]`)]
    expect(live([...move, e(3, 'checkin from', '[Undo] Temp checkout')])).toEqual([1])
  })

  it('Temp checkout, Bulk return, then undo of the return: the Temp checkout is open again', () => {
    const entries = [e(1, 'checkout', `[Temp checkout | due: ${due}]`), e(2, 'checkin from', '[Bulk return]'), e(3, 'checkout', undoNote('Bulk return', due))]
    expect(live(entries)).toEqual([1])
  })

  it('an undo with nothing left to cancel still drops out', () => {
    expect(live([e(1, 'checkout', '[Undo] Repair intake'), e(2, 'checkout', '[Repair intake] cracked screen')])).toEqual([2])
  })
})

describe('Reading notes loosely', () => {
  it('reads case and spacing loosely', () => {
    expect(parseWorkflowNote('[temp checkout|due:2026-10-13 14:50]')).toEqual({ workflow: 'Temp checkout', undo: false, text: '', due: '2026-10-13 14:50' })
    expect(parseWorkflowNote('  [ UNDO ]  bulk  return ')).toEqual({ workflow: 'Bulk return', undo: true })
    expect(parseWorkflowNote('[undo] Bulk return [temp checkout|due:2026-10-13 14:50]')).toEqual({ workflow: 'Bulk return', undo: true, due: '2026-10-13 14:50' })
  })

  it('ignores an unknown key or a malformed due or cost, and still counts the entry', () => {
    expect(parseWorkflowNote('[Incoming repair | colour: blue | cost: 45 dollars] screen replaced')).toEqual({ workflow: 'Incoming repair', undo: false, text: 'screen replaced' })
    expect(parseWorkflowNote('[Temp checkout | due: tomorrow at 3]')).toEqual({ workflow: 'Temp checkout', undo: false, text: '' })
    expect(parseWorkflowNote('[Undo] Bulk return [Temp checkout | due: 10/13]')).toEqual({ workflow: 'Bulk return', undo: true })
  })

  it('returns nothing for a note that doesn\'t start with a known tag', () => {
    for (const note of [null, '', 'checked out for the year', 'see [Bulk checkout]', '[Batch] old note', '[Undo] Batch', '[Undo]', '[Bulk checkout(link)']) {
      expect(parseWorkflowNote(note)).toBeNull()
      expect(parseAppNote(note)).toBeNull()
    }
  })

  it('a hand-typed note in the same form counts like one the app wrote', () => {
    expect(parseWorkflowNote('[Repair intake] keyboard missing keys')).toEqual({ workflow: 'Repair intake', undo: false, text: 'keyboard missing keys' })
  })
})

describe('App tags that aren\'t Workflows', () => {
  it('[Automatic check-in] and [Audit] are recognised but aren\'t Workflow entries', () => {
    const auto = appNote('Automatic check-in', 'Temp checkout not scanned back by 3:50 pm')
    expect(auto).toBe('[Automatic check-in] Temp checkout not scanned back by 3:50 pm')
    expect(parseAppNote(auto)).toEqual({ tag: 'Automatic check-in', text: 'Temp checkout not scanned back by 3:50 pm' })
    expect(parseAppNote('[automatic  check-in]')).toEqual({ tag: 'Automatic check-in', text: '' })
    expect(appNote('Audit')).toBe('[Audit]')
    expect(parseAppNote(appNote('Audit', 'seen in Room 204, sticker replaced'))).toEqual({ tag: 'Audit', text: 'seen in Room 204, sticker replaced' })
    for (const note of [auto, '[Audit]', '[Undo] Automatic check-in']) expect(parseWorkflowNote(note)).toBeNull()
    expect(parseAppNote('[Bulk return]')).toBeNull()
  })

  it('an automatic check-in can\'t be undone and isn\'t an undo target', () => {
    const entries = [{ id: 1, note: '[Temp checkout | due: 2026-10-13 14:50]' }, { id: 2, note: '[Automatic check-in] not back' }]
    expect(liveEntries(entries).map((x) => x.id)).toEqual([1, 2])
  })
})

describe('Cleaning what the Operator typed', () => {
  it('drops markup characters, joins lines and spaces, and trims', () => {
    expect(cleanText('  <b>cracked</b> *screen*_ `x` ~y~ back\\slash [a] | b \n\n  second   line ')).toBe('bcracked/b screen x y backslash a b second line')
    expect(workflowNote('Bulk checkout', { text: '  ** ' })).toBe('[Bulk checkout]')
    expect(workflowNote('Incoming repair', { supplier: 'Acme | Repair]', cost: '45' })).toBe('[Incoming repair | supplier: Acme Repair | cost: 45.00]')
  })

  it('refuses a link with a message', () => {
    expect(() => cleanText('see https://example.com')).toThrow('links')
    expect(() => workflowNote('Repair intake', { text: 'photo at HTTP://example.com' })).toThrow('links')
    expect(() => appNote('Audit', 'http://x')).toThrow('links')
  })

  it('writes a Repair cost typed as $45 or 45 as 45.00', () => {
    expect(repairCost('$45')).toBe('45.00')
    expect(repairCost('45')).toBe('45.00')
    expect(repairCost(' $ 12.5 ')).toBe('12.50')
    expect(() => repairCost('forty')).toThrow('Repair cost')
    expect(() => repairCost('-5')).toThrow('Repair cost')
  })

  it('refuses a malformed due time instead of writing it', () => {
    expect(() => workflowNote('Temp checkout', { due: '2026-10-13' })).toThrow('YYYY-MM-DD HH:MM')
  })
})

describe('User notes line', () => {
  it('reads [date] [Asset Tag] damaged – text (by Operator), and isn\'t a Workflow note', () => {
    const line = userNotesLine('2026-10-10', 'A01234', 'cracked screen, dropped in hallway', 'A. Tech')
    expect(line).toBe('[2026-10-10] [A01234] damaged – cracked screen, dropped in hallway (by A. Tech)')
    expect(line).toMatch(/^\[(\d{4}-\d{2}-\d{2})\] \[([^\]]+)\] damaged – (.*) \(by (.+)\)$/)
    expect(parseWorkflowNote(line)).toBeNull()
  })
})
