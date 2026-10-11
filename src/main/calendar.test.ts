import { describe, expect, it } from 'vitest'
import { dueAt, dueLabel, formatCalendar, parseCalendar } from './calendar'

// 2026-10-09 is a Friday, 2026-10-12 a Monday.
const at = (s: string) => new Date(`${s}:00`)
const times = (calendar = '') => ({ endOfDay: '14:50', calendar: parseCalendar(calendar) })

describe('when a Temp checkout is due', () => {
  it("before the end-of-day time on a School day: that day's end-of-day time", () => {
    expect(dueAt(at('2026-10-12T08:05'), times())).toBe('2026-10-12 14:50')
    expect(dueAt(at('2026-10-12T14:49'), times())).toBe('2026-10-12 14:50')
  })

  it('at or after it: the next School day; Friday after hours and the weekend go to Monday', () => {
    expect(dueAt(at('2026-10-12T14:50'), times())).toBe('2026-10-13 14:50')
    expect(dueAt(at('2026-10-09T15:30'), times())).toBe('2026-10-12 14:50')
    expect(dueAt(at('2026-10-10T10:00'), times())).toBe('2026-10-12 14:50')
    expect(dueAt(at('2026-10-11T10:00'), times())).toBe('2026-10-12 14:50')
  })

  it('skips a holiday and a break', () => {
    expect(dueAt(at('2026-10-09T15:00'), times('2026-10-12 Fall holiday'))).toBe('2026-10-13 14:50')
    expect(dueAt(at('2026-11-20T15:00'), times('2026-11-23 to 2026-11-27 Thanksgiving break'))).toBe('2026-11-30 14:50')
    expect(dueAt(at('2026-11-24T09:00'), times('2026-11-23 to 2026-11-27 Thanksgiving break'))).toBe('2026-11-30 14:50')
  })

  it("a half day ends at its own time; once that's passed, the next School day", () => {
    const half = times('2026-12-18 half day 12:00 Winter concert')
    expect(dueAt(at('2026-12-18T09:00'), half)).toBe('2026-12-18 12:00')
    expect(dueAt(at('2026-12-18T12:30'), half)).toBe('2026-12-21 14:50')
    expect(dueAt(at('2026-12-17T15:00'), half)).toBe('2026-12-18 12:00')
    expect(dueAt(at('2026-12-15T09:00'), times('2026-12-14 to 2026-12-18 half day 11:30 Exam week'))).toBe('2026-12-15 11:30')
  })

  it('no school beats a half day on the same date', () => {
    expect(dueAt(at('2026-12-17T15:00'), times('2026-12-18 half day 12:00 Winter concert\n2026-12-18 to 2027-01-01 Winter break'))).toBe('2027-01-04 14:50')
  })

  it('null when the calendar leaves no School day within a year', () => {
    expect(dueAt(at('2026-10-12T09:00'), times('2026-10-01 to 2027-12-31 Closed'))).toBeNull()
  })
})

describe('how a due time reads', () => {
  const now = at('2026-10-12T09:00')
  it('today, or with the weekday (and the date when long)', () => {
    expect(dueLabel('2026-10-12 14:50', now)).toBe('today 2:50 pm')
    expect(dueLabel('2026-10-13 14:50', now)).toBe('Tue 13 Oct 2:50 pm')
    expect(dueLabel('2026-10-12 12:00', now, true)).toBe('12:00 pm')
    expect(dueLabel('2026-10-13 09:05', now, true)).toBe('Tue 9:05 am')
  })
})

describe('the School calendar text', () => {
  it('reads dates, ranges and half days (a range can be one), each with a label, and shows them back sorted', () => {
    const entries = parseCalendar('2026-12-18 half day 12:00 Winter concert\n\n  2026-11-23 to 2026-11-27 Thanksgiving break\n2026-11-26 Thanksgiving\n2026-12-14 TO 2026-12-16 Half Day 9:30 Exams')
    expect(entries).toEqual([
      { from: '2026-11-23', to: '2026-11-27', label: 'Thanksgiving break' },
      { from: '2026-11-26', to: '2026-11-26', label: 'Thanksgiving' },
      { from: '2026-12-14', to: '2026-12-16', halfDay: '09:30', label: 'Exams' },
      { from: '2026-12-18', to: '2026-12-18', halfDay: '12:00', label: 'Winter concert' },
    ])
    expect(formatCalendar(entries)).toBe('2026-11-23 to 2026-11-27 Thanksgiving break\n2026-11-26 Thanksgiving\n2026-12-14 to 2026-12-16 half day 09:30 Exams\n2026-12-18 half day 12:00 Winter concert')
    expect(parseCalendar(formatCalendar(entries))).toEqual(entries)
    expect(parseCalendar('  \n')).toEqual([])
    // A label may start with "to": only "to" and a date makes a range.
    expect(parseCalendar('2026-11-26 To be announced')).toEqual([{ from: '2026-11-26', to: '2026-11-26', label: 'To be announced' }])
  })

  it('refuses the whole text at the first bad line, naming it and what is wrong', () => {
    const refused = (text: string) => () => parseCalendar(`2026-11-26 Thanksgiving\n${text}`)
    expect(refused('Thanksgiving 2026-11-26')).toThrow('Line 2: start with a date like 2026-11-26')
    expect(refused('2026-02-30 Leap')).toThrow("Line 2: 2026-02-30 isn't a real date")
    expect(refused('2026-11-23 to 11-27 Break')).toThrow('Line 2: the end date must be a date like 2026-11-27')
    expect(refused('2026-11-23 to 2026-11-31 Break')).toThrow("Line 2: 2026-11-31 isn't a real date")
    expect(refused('2026-11-27 to 2026-11-23 Break')).toThrow('Line 2: the end date is before the start date')
    expect(refused('2026-12-18 half day Winter concert')).toThrow('Line 2: a half day needs its time, like half day 12:00')
    expect(refused('2026-12-18 half day 25:00 Concert')).toThrow("Line 2: 25:00 isn't a real time")
    expect(refused('2026-12-18')).toThrow('Line 2: add a label, like Thanksgiving')
    expect(refused('2026-12-18 half day 12:00')).toThrow('Line 2: add a label, like Thanksgiving')
  })
})
