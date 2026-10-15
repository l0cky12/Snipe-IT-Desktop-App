import { describe, expect, it } from 'vitest'
import { BRAND_DEFAULTS } from './branding'
import { fileName } from './export'
import { checkExport, pdfFooter, reportHtml } from './report'

const when = new Date(2026, 9, 15, 14, 3)
const brand = { ...BRAND_DEFAULTS, name: 'Example School', footer: 'Confidential', icon: 'data:image/png;base64,AAAA' }
const table = { name: 'Overdue', columns: ['Asset Tag', 'Note'], rows: [['NOMMA-1', 'Charger <65W> & "cable"']] }

describe('HTML and PDF Reports', () => {
  it('carry the Branding (icon, name, colour, footer line), the day and the row count, with every cell escaped', () => {
    const html = reportHtml(table, when, brand)
    expect(html).toContain('<title>Overdue, Example School</title>')
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="">')
    expect(html).toContain('<div class="org">Example School</div><h1>Overdue</h1>')
    expect(html).toContain('background: #14285a; color: #ffffff')
    expect(html).toContain('<th>Asset Tag</th><th>Note</th>')
    expect(html).toContain('<td>NOMMA-1</td><td>Charger &lt;65W&gt; &amp; &quot;cable&quot;</td>')
    expect(html).toContain('October 15, 2026 at 2:03 PM<br>1 row')
    expect(html).toContain('<footer>Confidential</footer>')
  })

  it('show no icon or footer line when there is none; the PDF (paged) leaves the footer line to every page instead', () => {
    const html = reportHtml({ ...table, rows: [] }, when, { ...BRAND_DEFAULTS, icon: null })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<footer>')
    expect(html).toContain('0 rows')
    expect(reportHtml(table, when, brand, { paged: true })).not.toContain('<footer>')
    expect(pdfFooter(brand)).toContain('<span>Confidential</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>')
  })

  it('are named for what they hold, the day and the format; what the screen sends is checked', () => {
    expect(fileName('Activity Report', when, 'pdf')).toBe('activity-report-2026-10-15.pdf')
    expect(checkExport({ format: 'html', name: ' Users ', columns: ['Name'], rows: [['A']] })).toEqual({ format: 'html', name: 'Users', columns: ['Name'], rows: [['A']] })
    for (const bad of [{ format: 'docx', name: 'x', columns: [], rows: [] }, { format: 'csv', name: ' ', columns: [], rows: [] }, { format: 'csv', name: 'x', columns: ['a'], rows: [[1]] }, { format: 'csv', name: 'x', columns: 'a', rows: [] }])
      expect(() => checkExport(bad as never)).toThrow('Invalid export')
  })
})
