import { textOn, type Branding } from './branding'
import { rowCount } from './export'

/** The files Export… makes, each with its save dialog's filter name. */
export const FORMATS = { csv: 'CSV file', html: 'HTML page', pdf: 'PDF document' } as const
export type ExportFormat = keyof typeof FORMATS
/** A List or Report as shown, to save where the Operator chooses. name: what it holds ("Activity Report"), for the file and the title. */
export type ExportInput = { format: ExportFormat; name: string; columns: string[]; rows: string[][] }
/** save: false when the Operator cancelled the dialog; nothing is written without their choice. */
export type ExportApi = { save(input: ExportInput): Promise<boolean> }

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ENTITIES[c])

/** What the screen sends over IPC, checked. */
export function checkExport(input: ExportInput): ExportInput {
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')
  if (!Object.hasOwn(FORMATS, input?.format) || typeof input.name !== 'string' || !input.name.trim() || !strings(input.columns) || !Array.isArray(input.rows) || !input.rows.every(strings))
    throw new Error('Invalid export')
  return { format: input.format, name: input.name.trim(), columns: input.columns, rows: input.rows }
}

/**
 * A Report as one self-contained page: the Branding's icon, name and primary colour in the header band with the title,
 * when it was made and the row count; the table, black on white so it prints; the footer line under it. paged: for the
 * PDF, whose every page carries the footer line (pdfFooter) instead. The icon is a data: URL, so the file never loses it.
 */
export function reportHtml({ name, columns, rows }: Omit<ExportInput, 'format'>, when: Date, b: Branding, { paged = false } = {}): string {
  const cell = (tag: string) => (s: string) => `<${tag}>${escapeHtml(s)}</${tag}>`
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(`${name}, ${b.name}`)}</title><style>
@page { size: letter landscape; margin: .5in .5in .7in }
body { margin: 0; color: #000; background: #fff; font: 10pt/1.35 system-ui, sans-serif }
header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 6px; background: ${b.primary}; color: ${textOn(b.primary)} }
header img { width: 40px; height: 40px; object-fit: contain }
header h1 { margin: 0; font-size: 15pt }
header .org { font-weight: 600 }
header .meta { margin-left: auto; text-align: right; font-size: 9pt; opacity: .9 }
table { width: 100%; border-collapse: collapse; margin-top: 10px }
thead { display: table-header-group }
th { text-align: left; padding: 6px 8px; border-bottom: 2px solid ${b.primary}; font-size: 9pt }
td { padding: 5px 8px; border-bottom: 1px solid #ddd; vertical-align: top }
tbody tr:nth-child(even) { background: #f4f4f4 }
tr { break-inside: avoid }
footer { margin-top: 14px; font-size: 9pt; color: #555 }
</style>
<header>${b.icon ? `<img src="${b.icon}" alt="">` : ''}<div><div class="org">${escapeHtml(b.name)}</div><h1>${escapeHtml(name)}</h1></div><div class="meta">${escapeHtml(when.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }))}<br>${rowCount(rows.length)}</div></header>
<table><thead><tr>${columns.map(cell('th')).join('')}</tr></thead><tbody>
${rows.map((r) => `<tr>${r.map(cell('td')).join('')}</tr>`).join('\n')}
</tbody></table>
${b.footer && !paged ? `<footer>${escapeHtml(b.footer)}</footer>` : ''}
</html>`
}

/** printToPDF's footer on every page: the footer line left, "Page n of m" right. Its own styles: Chromium gives the template none of the page's. */
export const pdfFooter = (b: Branding) =>
  `<div style="width:100%;margin:0 .5in;display:flex;justify-content:space-between;font:8pt system-ui,sans-serif;color:#555"><span>${escapeHtml(b.footer)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
