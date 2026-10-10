// Workflow notes (#63): what every Workflow, the Audit action and Automatic check-in write into Snipe-IT, and how Reports read it back.
// Shared by the main process and the window, so it imports nothing.

export const WORKFLOWS = ['Bulk checkout', 'Bulk return', 'Repair intake', 'Incoming repair', 'Temp checkout'] as const
export type Workflow = (typeof WORKFLOWS)[number]
// Tags the app writes that aren't Workflows: nothing to undo, and Reports find audits by the `audit` action, not by this.
export const APP_TAGS = ['Automatic check-in', 'Audit'] as const
export type AppTag = (typeof APP_TAGS)[number]

export type WorkflowNote = { workflow: Workflow; undo: boolean; text?: string; move?: true; due?: string; supplier?: string; cost?: string }
export type WorkflowFields = { text?: string; move?: boolean; due?: string; supplier?: string; cost?: string }

const DUE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
const COST = /^\d+(\.\d{1,2})?$/

/** One line of free text as Snipe-IT will show it: no markup characters, no links. Throws with a message on a link. */
export function cleanText(s: string): string {
  // Snipe-IT turns a link into an anchor, and strips <…>; the rest is Markdown.
  if (/https?:\/\//i.test(s)) throw new Error('Notes can’t contain links (http:// or https://).')
  return s.replace(/[<>*_`~\\[\]|]/g, '').replace(/\s+/g, ' ').trim()
}

/** A Repair cost as typed (`$45`, `45`, `45.5`) written as Snipe-IT's `45.00`. */
export function repairCost(s: string): string {
  const v = s.trim().replace(/^\$\s*/, '')
  if (!COST.test(v)) throw new Error('Repair cost must be a number like 45 or 45.00.')
  return Number(v).toFixed(2)
}

const dueField = (due: string) => {
  if (!DUE.test(due)) throw new Error(`Due time must be YYYY-MM-DD HH:MM, not ${due}`)
  return `due: ${due}`
}
const withText = (tag: string, text = '') => {
  const t = cleanText(text)
  return t ? `${tag} ${t}` : tag
}

/** `[<Workflow> | field…] text`. Fields go in the grammar's order: move, due, supplier, cost. */
export function workflowNote(workflow: Workflow, { text, move, due, supplier, cost }: WorkflowFields = {}): string {
  const s = supplier === undefined ? '' : cleanText(supplier)
  const fields = [move && 'move', due && dueField(due), s && `supplier: ${s}`, cost && `cost: ${repairCost(cost)}`].filter(Boolean)
  return withText(`[${[workflow, ...fields].join(' | ')}]`, text)
}

/** `[Undo] <Workflow>`, plus the Temp checkout tag when the Checkout it puts back had a due time of day. */
export const undoNote = (workflow: Workflow, due?: string) => `[Undo] ${workflow}${due ? ` [Temp checkout | ${dueField(due)}]` : ''}`

/** `[Automatic check-in] text` or `[Audit] text`. */
export const appNote = (tag: AppTag, text?: string) => withText(`[${tag}]`, text)

/** The User notes line Repair intake adds: `[2026-10-10] [A01234] damaged – cracked screen (by A. Tech)`. */
export const userNotesLine = (date: string, assetTag: string, text: string, operator: string) =>
  `[${date}] [${assetTag}] damaged – ${cleanText(text)} (by ${cleanText(operator)})`

// The parser is #63 §5's reference: case and spacing read loosely, unknown keys and malformed values ignored.
// A run of spaces inside a name reads as one; canon() puts the name back as written here.
const loosely = (list: readonly string[]) => list.map((w) => w.replace(/ /g, '\\s+')).join('|')
const NAME = loosely(WORKFLOWS)
const TAG = new RegExp(`^\\[\\s*(${NAME})\\s*((?:\\|[^|\\]]*)*)\\]\\s*(.*)$`, 'is')
const UNDO = new RegExp(`^\\[\\s*undo\\s*\\]\\s*(${NAME})\\s*(.*)$`, 'is')
const APP = new RegExp(`^\\[\\s*(${loosely(APP_TAGS)})\\s*\\]\\s*(.*)$`, 'is')
const canon = <T extends string>(list: readonly T[], s: string) => list.find((w) => w.toLowerCase() === s.toLowerCase().replace(/\s+/g, ' '))!

function fields(raw: string, out: WorkflowNote) {
  for (const f of raw.split('|').slice(1).map((s) => s.trim()).filter(Boolean)) {
    if (f.toLowerCase() === 'move') { out.move = true; continue }
    const i = f.indexOf(':')
    if (i < 0) continue
    const k = f.slice(0, i).trim().toLowerCase(), v = f.slice(i + 1).trim()
    if (k === 'due' && DUE.test(v)) out.due = v
    else if (k === 'supplier' && v) out.supplier = v
    else if (k === 'cost' && COST.test(v)) out.cost = v
  }
  return out
}

/** The Workflow step a History note records, or null when it isn't a Workflow note (an app tag, or anything else). */
export function parseWorkflowNote(note: string | null): WorkflowNote | null {
  const s = (note ?? '').trim()
  const u = UNDO.exec(s)
  if (u) {
    const out: WorkflowNote = { workflow: canon(WORKFLOWS, u[1]), undo: true }
    // An undo that puts a Temp checkout back carries its tag.
    const t = TAG.exec(u[2])
    const due = t && canon(WORKFLOWS, t[1]) === 'Temp checkout' ? fields(t[2], {} as WorkflowNote).due : undefined
    return due ? { ...out, due } : out
  }
  const m = TAG.exec(s)
  return m ? fields(m[2], { workflow: canon(WORKFLOWS, m[1]), undo: false, text: m[3].trim() }) : null
}

/** `[Automatic check-in]` and `[Audit]` notes: written by the app, but not Workflow steps and never undone. */
export function parseAppNote(note: string | null): { tag: AppTag; text: string } | null {
  const m = APP.exec((note ?? '').trim())
  return m ? { tag: canon(APP_TAGS, m[1]), text: m[2].trim() } : null
}

/**
 * One Asset's entries, oldest first, without the undone steps: each `[Undo] W` cancels the newest earlier live entry
 * for W, and both drop out. Everything else, Workflow note or not, is kept. A Move undo makes two calls, so it cancels
 * the Checkout, then the move Checkin; if its second call failed, the move Checkin stays live, as happened in Snipe-IT.
 */
export function liveEntries<T extends { note: string | null }>(entries: readonly T[]): T[] {
  const notes = entries.map((e) => parseWorkflowNote(e.note))
  const cancelled = new Set<number>()
  notes.forEach((n, i) => {
    if (!n?.undo) return
    cancelled.add(i)
    for (let j = i - 1; j >= 0; j--) {
      const m = notes[j]
      if (!cancelled.has(j) && m && !m.undo && m.workflow === n.workflow) { cancelled.add(j); break }
    }
  })
  return entries.filter((_, i) => !cancelled.has(i))
}
