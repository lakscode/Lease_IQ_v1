import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { DOC_TYPE_LABELS, fetchLeaseClauses, type Lease, type LeaseClause } from './leases'
import { fetchInsights, groupInsights, INSIGHT_STATUS_LABELS, type InsightGroup } from './insights'

export type TermRow = [label: string, value: string | null | undefined]

/** The abstract fields shown on the Details page and in the downloadable report, by panel. */
export function leaseSections(lease: Lease) {
  const a = lease.abstract ?? {}
  return {
    property: [
      ['Premises', lease.premises ?? a.premises_address],
      ['Rentable area', a.rentable_area],
      ['Permitted use', a.permitted_use],
      ['Landlord', lease.landlord ?? a.landlord],
      ['Tenant', lease.tenant ?? a.tenant],
    ] as TermRow[],
    rent: [
      ['Base rent', a.base_rent],
      ['Escalations', a.rent_escalations],
      ['Security deposit', a.security_deposit],
      ['Operating expenses', a.operating_expenses],
    ] as TermRow[],
    dates: [
      ['Effective', lease.effective_date],
      ['Commencement', a.commencement_date],
      ['Expiration', a.expiration_date],
      ['Term', a.term],
      ['Notification Window Start Date', a.renewal_notification_window_start],
      ['Renewal Options Start Date', a.renewal_options_start],
    ] as TermRow[],
    options: [
      ['Renewal', a.renewal_options],
      ['Termination', a.termination_options],
      ...(lease.doc_type === 'main_lease' ? [] : [['Changes made', a.changes_made] as TermRow]),
    ] as TermRow[],
  }
}

export type ReportTask = { text: string; due: string; urgent: boolean }

type ReportInput = {
  lease: Lease
  fileName: string | null
  family: Lease[]
  tasks: ReportTask[]
  // Main lease of the family, whose revenue and risk opportunities are included.
  familyId: string
}

// ---------- Layout ----------

const PAGE_W = 612 // US Letter
const PAGE_H = 792
const MARGIN = 54
const CONTENT_W = PAGE_W - MARGIN * 2
const LABEL_W = 170

const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const ACCENT = rgb(0.31, 0.27, 0.9)
const RULE = rgb(0.89, 0.91, 0.94)
const URGENT = rgb(0.86, 0.15, 0.15)

// Standard PDF fonts only cover WinAnsi; swap or drop anything else so drawing never throws.
const REPLACEMENTS: Record<string, string> = { '↳': '-', '▶': '>', '✓': 'v', '✕': 'x', '≥': '>=', '≤': '<=', ' ': ' ' }
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
function clean(text: string) {
  return [...text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ')]
    .map((ch) => REPLACEMENTS[ch] ?? (ch === '\n' || (ch >= ' ' && ch <= 'ÿ') || WIN_ANSI_EXTRA.has(ch) ? ch : '?'))
    .join('')
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of clean(text).split('\n')) {
    let line = ''
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      // Break words longer than the whole line.
      let rest = word
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length - 1
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--
        lines.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

class Writer {
  page!: PDFPage
  y = 0

  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage()
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 20) this.newPage()
  }

  text(text: string, opts: { x?: number; width?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
    const { x = MARGIN, width = CONTENT_W, size = 10, bold = false, color = INK, gap = 0 } = opts
    const font = bold ? this.bold : this.font
    const lineH = size * 1.4
    for (const line of wrap(text, font, size, width)) {
      this.ensure(lineH)
      this.page.drawText(line, { x, y: this.y - size, size, font, color })
      this.y -= lineH
    }
    this.y -= gap
  }

  rule(gap = 8) {
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.75, color: RULE })
    this.y -= gap
  }

  heading(title: string) {
    this.ensure(48)
    this.y -= 14
    this.text(title, { size: 12.5, bold: true, color: ACCENT, gap: 2 })
    this.rule(6)
  }

  /** Label / value row; the value wraps in its own column and can span pages. */
  row(label: string, value: string | null | undefined) {
    const size = 9.5
    const lineH = size * 1.4
    const valueX = MARGIN + LABEL_W
    const labelLines = wrap(label, this.font, size, LABEL_W - 12)
    const valueLines = wrap(value?.trim() || '—', this.font, size, CONTENT_W - LABEL_W)
    this.ensure(lineH * Math.min(Math.max(labelLines.length, valueLines.length), 3))
    const top = this.y
    labelLines.forEach((line, i) => this.page.drawText(line, { x: MARGIN, y: top - size - i * lineH, size, font: this.font, color: MUTED }))
    for (const line of valueLines) {
      this.ensure(lineH)
      this.page.drawText(line, { x: valueX, y: this.y - size, size, font: this.font, color: INK })
      this.y -= lineH
    }
    this.y = Math.min(this.y, top - labelLines.length * lineH) - 5
  }

  /** Fixed-width columns; cells wrap and the row is as tall as its tallest cell. */
  tableRow(cells: string[], widths: number[], opts: { bold?: boolean; color?: ReturnType<typeof rgb>[] } = {}) {
    const size = 9.5
    const lineH = size * 1.4
    const font = opts.bold ? this.bold : this.font
    const wrapped = cells.map((c, i) => wrap(c, font, size, widths[i] - 10))
    const height = Math.max(...wrapped.map((l) => l.length)) * lineH
    this.ensure(height)
    let x = MARGIN
    wrapped.forEach((lines, i) => {
      lines.forEach((line, j) =>
        this.page.drawText(line, { x, y: this.y - size - j * lineH, size, font, color: opts.color?.[i] ?? (opts.bold ? MUTED : INK) }),
      )
      x += widths[i]
    })
    this.y -= height + 5
  }
}

/** Builds the lease abstract report as a PDF. */
export async function buildLeaseReport({ lease, fileName, family, tasks, familyId }: ReportInput): Promise<Uint8Array> {
  const [clauses, insights] = await Promise.all([
    fetchLeaseClauses(lease.id).catch((): LeaseClause[] => []),
    fetchInsights(familyId).catch(() => null),
  ])

  const doc = await PDFDocument.create()
  doc.setTitle(`${lease.title} - Lease Abstract`)
  doc.setCreator('LeaseIQ')
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold))

  const pages = lease.page_start === lease.page_end ? `p. ${lease.page_start}` : `pp. ${lease.page_start}-${lease.page_end}`
  w.text('LEASE ABSTRACT', { size: 9, bold: true, color: ACCENT, gap: 4 })
  w.text(lease.title, { size: 18, bold: true, gap: 4 })
  w.text(`${DOC_TYPE_LABELS[lease.doc_type]} · ${pages} of ${fileName ?? 'unknown file'} · Generated ${new Date().toLocaleString()}`, {
    size: 9,
    color: MUTED,
    gap: 8,
  })
  if (lease.summary) w.text(lease.summary, { size: 10, gap: 4 })

  const sections = leaseSections(lease)
  for (const [title, rows] of [
    ['Property', sections.property],
    ['Rent', sections.rent],
    ['Lease dates', sections.dates],
    ['Options', sections.options],
  ] as const) {
    w.heading(title)
    rows.forEach(([label, value]) => w.row(label, value))
  }

  w.heading('Related documents')
  const docWidths = [120, CONTENT_W - 210, 90]
  w.tableRow(['Type', 'Document', 'Effective'], docWidths, { bold: true })
  for (const d of family) {
    w.tableRow([DOC_TYPE_LABELS[d.doc_type], d.id === lease.id ? `${d.title} (this document)` : d.title, d.effective_date ?? '—'], docWidths)
  }

  w.heading('Alerts and tasks')
  if (!tasks.length) w.text('Nothing needs attention.', { size: 9.5, color: MUTED })
  else {
    const taskWidths = [CONTENT_W - 150, 90, 60]
    w.tableRow(['Task', 'Due', 'Priority'], taskWidths, { bold: true })
    for (const t of tasks) {
      w.tableRow([t.text, t.due, t.urgent ? 'Urgent' : 'Normal'], taskWidths, { color: [INK, INK, t.urgent ? URGENT : MUTED] })
    }
  }

  for (const [group, title] of [
    ['revenue', 'Revenue opportunities'],
    ['risk', 'Risk opportunities'],
  ] as Array<[InsightGroup, string]>) {
    w.heading(title)
    if (insights?.status !== 'ready') {
      w.text('Not generated. Use Generate on the lease Details page.', { size: 9.5, color: MUTED })
      continue
    }
    const items = groupInsights(insights.items, group)
    for (const i of items.filter((x) => x.status !== 'none')) {
      w.ensure(40)
      const status = INSIGHT_STATUS_LABELS[i.status].toUpperCase()
      w.text(`${i.label}  ·  ${status}${i.status === 'action' && i.priority === 'high' ? ' · HIGH PRIORITY' : ''}`, {
        size: 10,
        bold: true,
        color: i.status === 'action' ? URGENT : INK,
        gap: 1,
      })
      w.text(i.summary, { x: MARGIN + 12, width: CONTENT_W - 12, size: 9.5 })
      if (i.detail) w.text(i.detail, { x: MARGIN + 12, width: CONTENT_W - 12, size: 9, color: MUTED })
      const meta = [
        i.due_date && `Due ${i.due_date}`,
        i.amount,
        ...i.citations.map((c) => (c.leaseId === lease.id ? `p. ${c.page}` : `${c.title}, p. ${c.page}`)),
      ].filter(Boolean)
      if (meta.length) w.text(meta.join('  ·  '), { x: MARGIN + 12, width: CONTENT_W - 12, size: 8.5, color: MUTED })
      w.y -= 6
    }
    const absent = items.filter((x) => x.status === 'none')
    if (absent.length) w.text(`Not in lease: ${absent.map((x) => x.label).join(', ')}`, { size: 8.5, color: MUTED })
  }

  w.heading(`Clauses (${clauses.length})`)
  if (!clauses.length) w.text('No clauses have been classified for this document.', { size: 9.5, color: MUTED })
  const groups = new Map<string, LeaseClause[]>()
  for (const c of clauses) groups.set(c.label, [...(groups.get(c.label) ?? []), c])
  for (const [label, items] of [...groups].sort((x, y) => x[0].localeCompare(y[0]))) {
    w.ensure(40)
    w.y -= 4
    w.text(`${label} (${items.length})`, { size: 10.5, bold: true, gap: 2 })
    for (const c of items) {
      w.text(`p. ${c.page_number}`, { x: MARGIN + 12, width: CONTENT_W - 12, size: 8.5, color: MUTED })
      w.text(c.text, { x: MARGIN + 12, width: CONTENT_W - 12, size: 9.5, gap: 6 })
    }
  }

  const all = doc.getPages()
  all.forEach((page, i) => {
    const footer = `LeaseIQ · ${clean(lease.title)}`
    const size = 8
    const font = w.font
    const maxW = CONTENT_W - 80
    let shown = footer
    while (font.widthOfTextAtSize(shown, size) > maxW && shown.length > 10) shown = `${shown.slice(0, -2)}…`
    page.drawText(shown, { x: MARGIN, y: MARGIN - 24, size, font, color: MUTED })
    const num = `Page ${i + 1} of ${all.length}`
    page.drawText(num, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(num, size), y: MARGIN - 24, size, font, color: MUTED })
  })

  return doc.save()
}

/** Builds the report and starts the browser download. */
export async function downloadLeaseReport(input: ReportInput) {
  const bytes = await buildLeaseReport(input)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${input.lease.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)} - Lease Abstract.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
