import { describe, expect, it } from 'vitest'
import { toCsv } from './ReportsView'

describe('CSV export', () => {
  it('quotes every cell, doubles quotes, keeps commas and line breaks, and marks it UTF-8 for Excel', () => {
    expect(toCsv(['Asset Tag', 'Note'], [['NOMMA-1', 'Charger, "65W"\nincluded']])).toBe('\uFEFF"Asset Tag","Note"\r\n"NOMMA-1","Charger, ""65W""\nincluded"\r\n')
  })

  it("a cell a spreadsheet would run as a formula can't become one", () => {
    expect(toCsv(['Note'], [['=HYPERLINK("http://x")'], ['+1'], ['-2'], ['@SUM(A1)'], ['plain']]).split('\r\n').slice(1, 6))
      .toEqual(['"\'=HYPERLINK(""http://x"")"', '"\'+1"', '"\'-2"', '"\'@SUM(A1)"', '"plain"'])
  })
})
