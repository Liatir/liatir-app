/**
 * The Stage page format: what Quenta builds on the Stage, as data — one page that scrolls, made of
 * sections. The model fills in this document instead of writing code; the frame draws it. Each element below is one entry — its one-line use for the
 * model's guide and its fields — and everything else (the schema the model is held to, the guide
 * text, the check and the renderer's types) is derived from these entries.
 *
 * To add an element: add an entry here and its renderer in `liatir/elements/` (the type check there
 * fails until every element has one).
 */
import { choice, either, field, flag, list, number, object, optional, text, whole, type Field, type Fields, type Json, type TypeOf } from "./schema"
import { numberColumn, usableColumns, type SourceTable } from "./tables"

export const ACCENTS = ["teal", "blue", "violet", "rose", "amber", "green", "slate"] as const
export const BACKGROUNDS = ["plain", "tint", "gradient", "dots", "grid"] as const
export const ILLUSTRATIONS = ["dna", "molecule", "cells", "network", "waves", "rings"] as const
export const ICONS = [
  "atom", "beaker", "flask", "microscope", "dna", "pill", "syringe", "heart", "brain", "leaf", "bug", "droplet", "thermometer",
  "activity", "chart", "target", "scale", "filter", "search", "layers", "database", "file", "cpu", "settings",
  "lightbulb", "sparkles", "zap", "rocket", "star", "puzzle", "key", "lock", "shield", "book", "clock", "users", "globe",
  "check", "warning", "info", "trending-up", "trending-down",
] as const

/** Above this many distinct column names the model is not held to the list (the grammar would be huge). */
const MAX_COLUMN_CHOICES = 200

// Marks are read by `pageFormat` and by the guide, and never reach the model's schema.
const marked = <T, O extends boolean>(value: Field<T, O>, mark: string): Field<T, O> => ({ ...value, json: { ...value.json, "x-liatir": mark } })
/** The id of one of the source tables (T1, T2 …). */
const table = () => marked(text(), "table")
/** The exact name of a column of a source table. */
const column = () => marked(text(), "column")
/** One of the icon names, listed once in the guide as ICON. */
const icon = () => { const names = choice(...ICONS); return { ...names, json: { ...names.json, "x-name": "ICON" } } }
/** A way of reading data from a source table; offered only when the request has tables. */
const fromTable = <P extends Fields>(properties: P) => marked(object(properties), "from-table")

// Data is always either typed by the model or read from a table, in one of these six forms.
const SERIES = either("SERIES",
  object({ labels: list(text(), 1, 60), series: list(object({ name: text(), values: list(number(), 1, 60) }), 1, 8) }),
  fromTable({ table: table(), x: column(), y: list(column(), 1, 8), sort: optional(choice("ascending", "descending")), limit: optional(whole(1, 200)) }))
const POINTS = either("POINTS",
  object({ series: list(object({ name: text(), x: list(number(), 1, 200), y: list(number(), 1, 200) }), 1, 8) }),
  fromTable({ table: table(), x: column(), y: column(), group: optional(column()) }))
const SAMPLES = either("SAMPLES",
  object({ series: list(object({ name: text(), values: list(number(), 1, 200) }), 1, 12) }),
  fromTable({ table: table(), y: list(column(), 1, 12), group: optional(column()) }))
const NUMBERS = either("NUMBERS",
  object({ name: text(), values: list(number(), 1, 500), labels: optional(list(text(), 1, 500)) }),
  fromTable({ table: table(), column: column(), label: optional(column()) }))
const ROWS = either("ROWS",
  object({ columns: list(text(), 1, 8), rows: list(list(text(), 1, 8), 1, 30) }),
  fromTable({ table: table(), columns: optional(list(column(), 1, 12)), limit: optional(whole(1, 1000)) }))
const VALUE = either("VALUE",
  text(),
  fromTable({ table: table(), column: column(), stat: choice("min", "max", "mean", "median", "sum", "count") }))
const FORMS = [SERIES, POINTS, SAMPLES, NUMBERS, ROWS, VALUE]

export type SeriesData = TypeOf<typeof SERIES>
export type PointsData = TypeOf<typeof POINTS>
export type SamplesData = TypeOf<typeof SAMPLES>
export type NumbersData = TypeOf<typeof NUMBERS>
export type RowsData = TypeOf<typeof ROWS>
export type ValueData = TypeOf<typeof VALUE>

const element = <P extends Fields>(use: string, properties: P) => ({ use, field: object(properties) })
const entry = object({ title: text(), text: optional(text()) })
const side = object({ title: text(), items: list(text(), 1, 6) })

const LEAVES = {
  // Words
  "text": element("A paragraph. **bold**, *italic* and `code` work in every text.", { text: text(), size: optional(choice("small", "normal", "large")) }),
  "heading": element("A sub-heading inside a section.", { text: text() }),
  "bullets": element("A short list.", { items: list(text(), 1, 8), marker: optional(choice("dot", "check", "arrow", "number")) }),
  "steps": element("Numbered steps of a method.", { items: list(entry, 2, 6) }),
  "timeline": element("Events in order.", { items: list(object({ when: text(), title: text(), text: optional(text()) }), 2, 6) }),
  "quote": element("Words quoted from the request or DATA, with who said them; for your own words use statement.", { text: text(), author: optional(text()) }),
  "statement": element("One big sentence, centred.", { text: text() }),
  "callout": element("A highlighted note, limitation or warning.", { tone: choice("info", "success", "warning", "danger"), text: text(), title: optional(text()) }),
  "code": element("A command or snippet in monospace.", { code: text(), caption: optional(text()) }),
  "terms": element("Words with their plain explanation.", { items: list(object({ term: text(), text: text() }), 1, 6) }),
  "comparison": element("Two sides compared: before/after, for/against.", { left: side, right: side }),
  "icon-cards": element("Small cards, each with an icon.", { items: list(object({ icon: icon(), title: text(), text: optional(text()) }), 2, 6) }),
  "badges": element("A row of small labels.", { items: list(text(), 1, 8) }),
  "facts": element("Label and value pairs.", { items: list(object({ label: text(), value: text() }), 1, 8) }),
  // Numbers and data
  "key-number": element("One big number.", { label: text(), value: VALUE, unit: optional(text()), note: optional(text()), trend: optional(choice("up", "down", "flat")) }),
  "progress": element("Bars from 0 to 100 percent.", { items: list(object({ label: text(), percent: number() }), 1, 6) }),
  "bar-chart": element("Bars by category.", { data: SERIES, title: optional(text()), unit: optional(text()), horizontal: optional(flag()), stacked: optional(flag()) }),
  "line-chart": element("Lines over ordered labels; area fills under them.", { data: SERIES, title: optional(text()), unit: optional(text()), area: optional(flag()) }),
  "pie-chart": element("Shares of a whole (one series).", { data: SERIES, title: optional(text()) }),
  "scatter-chart": element("Points on two number axes.", { data: POINTS, title: optional(text()), xLabel: optional(text()), yLabel: optional(text()) }),
  "histogram": element("How numbers are distributed; several series, or a group column, are stacked in the same ranges.", { data: SAMPLES, title: optional(text()), bins: optional(whole(2, 40)) }),
  "box-plot": element("Spread of numbers per group.", { data: SAMPLES, title: optional(text()), unit: optional(text()) }),
  "heatmap": element("A grid coloured by value: one row per label, one column per series.", { data: SERIES, title: optional(text()), unit: optional(text()) }),
  "funnel": element("Stages that narrow, e.g. reads kept after each filter (one series).", { data: SERIES, title: optional(text()), unit: optional(text()) }),
  "table": element("Rows with sorting, search and pages.", { data: ROWS, title: optional(text()) }),
  "threshold": element("A slider: the viewer moves a limit over a list of numbers and sees how many pass.", { data: NUMBERS, label: text(), pass: choice("below", "above"), unit: optional(text()) }),
  // Diagrams
  "flow": element("Boxes joined by arrows, for a process.", { items: list(entry, 2, 6), direction: optional(choice("right", "down")) }),
  "cycle": element("Steps that repeat in a loop.", { items: list(entry, 3, 6) }),
  "venn": element("Two or three overlapping circles.", { sets: list(text(), 2, 3), overlap: optional(text()) }),
  // Interactive
  "accordion": element("Sections that open on click.", { items: list(object({ title: text(), text: text() }), 1, 6) }),
  "hint": element("A term that shows its explanation on click.", { term: text(), text: text() }),
  "quiz": element("A question the viewer answers; answer is the number of the right option.", { question: text(), options: list(text(), 2, 5), answer: whole(1, 5), explanation: optional(text()) }),
  "reveal": element("Text hidden behind a button.", { button: text(), text: text() }),
  "checklist": element("A list the viewer can tick.", { items: list(text(), 1, 8) }),
  "walkthrough": element("Steps shown one at a time, with Next and Back.", { items: list(object({ title: text(), text: text() }), 2, 8) }),
  "flip-cards": element("Cards that turn over on click.", { items: list(object({ front: text(), back: text() }), 1, 6) }),
  // Decoration
  "divider": element("A thin line, with an optional label.", { label: optional(text()) }),
  "spacer": element("Empty space.", { size: optional(choice("small", "medium", "large")) }),
  "banner": element("A coloured panel with a title.", { title: text(), text: optional(text()), icon: optional(icon()) }),
  "illustration": element("A decorative drawing.", { name: choice(...ILLUSTRATIONS), caption: optional(text()) }),
  "icon": element("One large icon.", { name: icon(), label: optional(text()) }),
}

type Definitions = Record<string, { use: string; field: Field<unknown> }>
type Flatten<T> = { [K in keyof T]: T[K] } & {}
type ElementsOf<D extends Definitions> = { [K in keyof D]: Flatten<{ type: K } & TypeOf<D[K]["field"]> & { /** Grid columns this element takes. */ span?: number }> }[keyof D]

/** An element that holds no other elements. Containers hold these, so nesting is one level deep. */
export type Leaf = ElementsOf<typeof LEAVES>
const leaf = field<Leaf>({ $ref: "#/$defs/leaf" })

const CONTAINERS = {
  "card": element("A boxed group of elements.", { blocks: list(leaf, 1, 6), title: optional(text()), columns: optional(whole(1, 3)) }),
  "grid": element("Elements side by side inside one cell of the section.", { columns: whole(1, 4), blocks: list(leaf, 1, 8) }),
  "tabs": element("Views the viewer switches between.", { tabs: list(object({ label: text(), blocks: list(leaf, 1, 4) }), 2, 5), style: optional(choice("tabs", "buttons", "dropdown")) }),
  "popup": element("A button that opens a window with more detail.", { button: text(), title: text(), blocks: list(leaf, 1, 4) }),
}

export type Block = Leaf | ElementsOf<typeof CONTAINERS>
export type BlockType = Block["type"]
export type BlockOf<K extends BlockType> = Extract<Block, { type: K }>
const block = field<Block>({ $ref: "#/$defs/block" })

const section = object({
  title: text(),
  columns: whole(1, 4),
  blocks: list(block, 1, 8),
  subtitle: optional(text()),
  background: optional(choice(...BACKGROUNDS)),
})
const page = object({
  title: text(),
  subtitle: text(),
  accent: choice(...ACCENTS),
  sections: list(section, 2, 10),
  closing: object({ title: text(), text: text() }),
})

export type Section = TypeOf<typeof section>
export type Page = TypeOf<typeof page>

const DEFINITIONS: Definitions = { ...LEAVES, ...CONTAINERS }
export const BLOCK_TYPES = Object.keys(DEFINITIONS) as BlockType[]

/** An element's schema: its own fields plus `type` first and the shared `span` last. */
function elementJson(type: string): Json {
  const json = DEFINITIONS[type].field.json as { required: string[]; properties: Json }
  return { ...json, required: ["type", ...json.required], properties: { type: { const: type }, ...json.properties, span: { type: "integer", minimum: 1, maximum: 4 } } }
}

const SCHEMA: Json = {
  ...page.json,
  $defs: {
    leaf: { anyOf: Object.keys(LEAVES).map(elementJson) },
    block: { anyOf: [{ $ref: "#/$defs/leaf" }, ...Object.keys(CONTAINERS).map(elementJson)] },
  },
}

/**
 * The JSON Schema for one request. Table ids and column names become closed lists of the tables that
 * request really has, so the model cannot name one that does not exist; with no tables, the "read
 * from a table" forms are not offered at all.
 */
export function pageFormat(tables: readonly SourceTable[]): Json {
  const ids = tables.map((item) => item.id)
  const columns = usableColumns(tables)
  const adapt = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(adapt)
    if (!node || typeof node !== "object") return node
    const json = node as Json
    if (json["x-liatir"] === "table") return { type: "string", enum: ids }
    if (json["x-liatir"] === "column") return columns.length <= MAX_COLUMN_CHOICES ? { type: "string", enum: columns } : { type: "string", minLength: 1 }
    if (Array.isArray(json.anyOf)) {
      const options = (json.anyOf as Json[]).filter((option) => ids.length > 0 || option["x-liatir"] !== "from-table")
      return options.length === 1 ? adapt(options[0]) : { anyOf: options.map(adapt) }
    }
    return Object.fromEntries(Object.entries(json).filter(([key]) => !key.startsWith("x-")).map(([key, value]) => [key, adapt(value)]))
  }
  return adapt(SCHEMA) as Json
}

/** A schema as the short notation used in the guide: `{ label, value: VALUE, unit? }`. */
function notation(json: Json): string {
  if (typeof json["x-name"] === "string") return json["x-name"]
  if (json.$ref) return "element"
  if (json["x-liatir"] === "table") return "T1…"
  if (json["x-liatir"] === "column") return "column"
  if (Array.isArray(json.enum)) return json.enum.join("|")
  switch (json.type) {
    case "number": return "number"
    case "integer": return `${json.minimum}-${json.maximum}`
    case "boolean": return "true|false"
    case "array": return `[${notation(json.items as Json)}]`
    case "object": {
      const required = json.required as string[]
      const fields = Object.entries(json.properties as Record<string, Json>).map(([key, value]) => {
        const kind = notation(value)
        return `${key}${required.includes(key) ? "" : "?"}${kind === "text" ? "" : `: ${kind}`}`
      })
      return fields.length ? `{ ${fields.join(", ")} }` : "{}"
    }
  }
  return "text"
}

/** The format reference given to the model, generated from the definitions above. */
export function pageGuide(tables: readonly SourceTable[]): string {
  const elements = BLOCK_TYPES.map((type) => `- ${type}: ${DEFINITIONS[type].use} ${notation(DEFINITIONS[type].field.json)}`)
  const forms = FORMS.map((form) => {
    const [typed, read] = form.json.anyOf as Json[]
    return `${form.json["x-name"]} = ${notation(typed)}${tables.length ? ` typed by you, or ${notation(read)} read from a table` : ""}`
  })
  return `Page = ${notation(page.json)}\nElements (type: use { fields }; ? marks an optional field; every element may add span: 1-4):\n${elements.join("\n")}\nData forms:\n${forms.join("\n")}\nICON = ${ICONS.join("|")}`
}

/** A small complete page shown to the model as the pattern, built on the request's own first table. */
export function examplePage(tables: readonly SourceTable[]): Page {
  const limitation: Block = { type: "callout", tone: "warning", text: "Say here what the numbers cannot tell.", title: "Limitation" }
  for (const item of tables) {
    const value = item.columns.findIndex((_, index) => numberColumn(item, index))
    const name = item.columns.findIndex((_, index) => index !== value && !numberColumn(item, index))
    if (value < 0 || name < 0) continue
    return {
      title: "A short title", subtitle: "What was measured, in one line", accent: "teal",
      sections: [
        { title: "The result at a glance", columns: 3, blocks: [
          { type: "bar-chart", data: { table: item.id, x: item.columns[name], y: [item.columns[value]], sort: "descending" }, span: 2 },
          { type: "key-number", label: `Highest ${item.columns[value]}`, value: { table: item.id, column: item.columns[value], stat: "max" } },
        ] },
        { title: "How to read it", columns: 2, blocks: [{ type: "bullets", items: ["One short point", "Another short point"], marker: "check" }, limitation] },
      ],
      closing: { title: "Take-home message", text: "The one thing to remember." },
    }
  }
  return {
    title: "A short title", subtitle: "The idea in one line", accent: "blue",
    sections: [
      { title: "How it works", columns: 1, blocks: [{ type: "flow", items: [{ title: "First step", text: "What happens" }, { title: "Second step" }, { title: "Result" }] }] },
      { title: "Check your understanding", columns: 2, blocks: [
        { type: "quiz", question: "A question about the idea?", options: ["A wrong answer", "The right answer"], answer: 2, explanation: "Why it is right." },
        limitation,
      ] },
    ],
    closing: { title: "Take-home message", text: "The one thing to remember." },
  }
}
