/**
 * The tables of the Results a presentation is about. The model never retypes measured values: it names
 * a table and its columns, and both the check and the renderer read the numbers from the frozen copy
 * of the Results through the functions here. Everything in this file is pure and shared by the app
 * (prompt and check) and the frame (drawing).
 */

/** What the kit reads of a source Result; the app's presentation sources have this shape. */
export interface StageSource {
  label: string
  tool?: string
  output: unknown
}

export type Cell = string | number

export interface SourceTable {
  /** Short name the model uses: T1, T2 … in the order below. */
  id: string
  label: string
  /** The Result's label, shown under anything drawn from this table. */
  result: string
  /** Index of the Result in the sources. */
  source: number
  columns: string[]
  rows: Cell[][]
}

const MAX_TABLES = 24
/** Columns per table the model is told about and may name. */
const MAX_COLUMNS = 40
const SAMPLE_ROWS = 8

type Section = { type?: unknown; [key: string]: unknown }

function sectionsOf(source: StageSource): Section[] {
  const sections = (source.output as { sections?: unknown } | null)?.sections
  return Array.isArray(sections) ? sections.filter((section): section is Section => Boolean(section) && typeof section === "object") : []
}

const cell = (value: unknown): Cell => (typeof value === "number" && Number.isFinite(value) ? value : String(value ?? ""))

/**
 * Every table found in the sources, in a fixed order: table sections as they are, each list of summary
 * values as a Name/Value table, and a Result's single numbers together as one table.
 */
export function sourceTables(sources: readonly StageSource[]): SourceTable[] {
  const tables: SourceTable[] = []
  const add = (source: number, label: string, columns: string[], rows: Cell[][]) => {
    if (columns.length && rows.length && tables.length < MAX_TABLES) {
      tables.push({ id: `T${tables.length + 1}`, label, result: sources[source].label, source, columns, rows })
    }
  }
  sources.forEach((source, index) => {
    const numbers: Cell[][] = []
    for (const section of sectionsOf(source)) {
      if (section.type === "table" && Array.isArray(section.headers) && Array.isArray(section.rows)) {
        add(index, String(section.label ?? "Table"), section.headers.map(String), section.rows.filter(Array.isArray).map((row: unknown[]) => row.map(cell)))
      } else if (section.type === "stats" && Array.isArray(section.items)) {
        add(index, "Summary values", ["Name", "Value"], section.items.map((item: { label?: unknown; value?: unknown } | null) => [String(item?.label ?? ""), cell(item?.value)]))
      } else if (section.type === "number") {
        numbers.push([String(section.label ?? ""), cell(section.value), String(section.unit ?? "")])
      }
    }
    add(index, "Key numbers", ["Name", "Value", "Unit"], numbers)
  })
  return tables
}

/** A cell as a number, or null when it does not hold one. */
export function toNumber(value: Cell | undefined): number | null {
  if (typeof value === "number") return value
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** The columns the model may name: the first ones of every table, without repeats. */
export function usableColumns(tables: readonly SourceTable[]): string[] {
  return [...new Set(tables.flatMap((table) => table.columns.slice(0, MAX_COLUMNS)))]
}

/** The numbers of a column, or null when it is a text column: nearly every filled cell must be a number. */
export function numberColumn(table: SourceTable, index: number): number[] | null {
  const numbers = table.rows.map((row) => toNumber(row[index])).filter((value): value is number => value !== null)
  const filled = table.rows.filter((row) => String(row[index] ?? "").trim()).length
  return numbers.length && numbers.length >= filled * 0.8 ? numbers : null
}

function describeColumn(table: SourceTable, index: number): string {
  const numbers = numberColumn(table, index)
  // Reduced, not spread: a column can hold more values than a call can take arguments.
  return numbers ? `number, ${numbers.reduce((a, b) => Math.min(a, b))} to ${numbers.reduce((a, b) => Math.max(a, b))}` : "text"
}

const clip = (value: unknown, length: number) => {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim()
  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}

/**
 * The compact description of the sources given to the model: each table with its columns and a few
 * sample rows (charts and tables read all rows themselves), and the start of each text section.
 */
export function describeSources(sources: readonly StageSource[], tables: readonly SourceTable[] = sourceTables(sources)): string {
  return sources.map((source, index) => {
    const lines = [`Result "${source.label}"${source.tool ? ` (${source.tool})` : ""}`]
    for (const table of tables.filter((item) => item.source === index)) {
      const columns = table.columns.slice(0, MAX_COLUMNS).map((name, position) => `"${name}" (${describeColumn(table, position)})`)
      const hidden = table.columns.length - columns.length
      lines.push(`${table.id} "${table.label}": ${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}. Columns: ${columns.join(", ")}${hidden > 0 ? `, and ${hidden} more not listed` : ""}`)
      for (const row of table.rows.slice(0, SAMPLE_ROWS)) lines.push(`  ${row.slice(0, MAX_COLUMNS).map((value) => clip(value, 40)).join(" | ")}`)
      if (table.rows.length > SAMPLE_ROWS) lines.push(`  … ${table.rows.length - SAMPLE_ROWS} more rows`)
    }
    for (const section of sectionsOf(source)) {
      if (section.type === "text" && !section.raw && typeof section.content === "string") lines.push(`Text "${clip(section.label, 60)}": ${clip(section.content, 500)}`)
    }
    if (lines.length === 1) lines.push("(nothing in this Result can be shown as a table or text)")
    return lines.join("\n")
  }).join("\n\n")
}
